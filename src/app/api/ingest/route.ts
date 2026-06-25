import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { isSameProperty } from "@/lib/dedup";
import type { Comparable, Listing, RunStats } from "@/lib/types";

export const runtime = "nodejs";

// Fusion des résultats d'un run multi-sources. `existing` (déjà présents, taggés)
// + `incoming` (une seule source). Dédup cross-source (géo<150m + surface±2 +
// prix±3 %) : un bien retrouvé sur les 2 portails devient source='both' (atHome
// primaire) avec altUrl vers l'autre annonce. Ambigu (multi-lots) => gardé séparé.
function mergeRunResults(existing: Comparable[], incoming: Comparable[]): Comparable[] {
  const out = existing.slice();
  for (const inc of incoming) {
    const incSrc = inc.source === "both" ? "athome" : inc.source ?? "athome";
    const hits: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      const eSrc = e.source === "both" ? "athome" : e.source ?? "athome";
      if (eSrc === incSrc) continue; // même source : pas de fusion (PK gère les re-scrapes)
      if (
        isSameProperty(
          { price: e.price, surface: e.surface, lat: e.lat ?? null, lng: e.lng ?? null },
          { price: inc.price, surface: inc.surface, lat: inc.lat ?? null, lng: inc.lng ?? null }
        )
      )
        hits.push(i);
    }
    if (hits.length === 1) {
      const i = hits[0];
      const other = out[i];
      out[i] =
        incSrc === "athome"
          ? { ...inc, source: "both", altUrl: other.url }
          : { ...other, source: "both", altUrl: inc.url };
    } else {
      out.push(inc); // 0 match ou ambigu => bien séparé
    }
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "json invalide" }, { status: 400 });

    const expected = process.env.INGEST_SECRET || "";
    if (expected && body.secret !== expected) {
      return NextResponse.json({ error: "secret invalide" }, { status: 401 });
    }

    const { runId, listings, stats, error } = body as {
      runId: number;
      listings?: Listing[];
      stats?: RunStats;
      error?: string;
    };
    if (!runId) return NextResponse.json({ error: "runId requis" }, { status: 400 });

    const statsJson = stats ? JSON.stringify(stats) : null;

    if (error) {
      await pool.query(
        `UPDATE runs SET status='error', error=$2, stats=$3, finished_at=now() WHERE id=$1`,
        [runId, String(error), statsJson]
      );
      return NextResponse.json({ ok: true });
    }

    const runRow = await pool.query(`SELECT id FROM runs WHERE id=$1`, [runId]);
    if (!runRow.rows.length) return NextResponse.json({ error: "run introuvable" }, { status: 404 });

    const safe = Array.isArray(listings) ? listings : [];
    const filtered = safe.filter(
      (l) => l && typeof l.price === "number" && typeof l.surface === "number" && l.surface > 0
    );

    // Source du POST ('athome' par défaut). Les biens immotop reçoivent un id
    // préfixé pour ne pas entrer en collision avec les ids atHome.
    const sourceTag: "athome" | "immotop" = (body as any).source === "immotop" ? "immotop" : "athome";
    const items = filtered.map((l) => ({
      ...l,
      id: sourceTag === "immotop" ? `immotop-${l.id}` : String(l.id),
    }));

    // Réconciliation des exclusions (biens transmis vs rejetés faute de prix/surface).
    const mergedStats: RunStats | null = stats
      ? { ...stats, countReceived: safe.length, countIncomplete: safe.length - filtered.length }
      : null;
    const mergedStatsJson = mergedStats ? JSON.stringify(mergedStats) : statsJson;

    // Prix actuellement stockés (détection baisse/hausse). 1 SELECT batch.
    const ids = items.map((l) => l.id);
    const prevRows =
      ids.length > 0
        ? (
            await pool.query<{ id: string; price: number }>(
              `SELECT id, price FROM listings WHERE id = ANY($1)`,
              [ids]
            )
          ).rows
        : [];
    const prevPriceMap = new Map(prevRows.map((r) => [r.id, r.price]));

    // Upsert (ne touche jamais first_seen ; n'écrase ni photos existantes par un
    // tableau vide, ni des coordonnées connues par null).
    await Promise.all(
      items.map((l) => {
        const photos = Array.isArray(l.photos)
          ? l.photos.filter((p) => typeof p === "string" && p.startsWith("http")).slice(0, 6)
          : [];
        return pool.query(
          `INSERT INTO listings (id, source, price, surface, commune, rooms, title, url, cpe, photos, lat, lng, address, etat)
           VALUES ($1, $13, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $14)
           ON CONFLICT (id) DO UPDATE SET
             last_seen  = now(),
             prev_price = CASE WHEN listings.price <> EXCLUDED.price THEN listings.price ELSE listings.prev_price END,
             price   = EXCLUDED.price,
             surface = EXCLUDED.surface,
             commune = EXCLUDED.commune,
             rooms   = EXCLUDED.rooms,
             title   = EXCLUDED.title,
             url     = EXCLUDED.url,
             cpe     = EXCLUDED.cpe,
             photos  = CASE WHEN jsonb_array_length(EXCLUDED.photos) > 0 THEN EXCLUDED.photos ELSE listings.photos END,
             lat     = COALESCE(EXCLUDED.lat, listings.lat),
             lng     = COALESCE(EXCLUDED.lng, listings.lng),
             etat    = COALESCE(EXCLUDED.etat, listings.etat),
             address = CASE WHEN EXCLUDED.address IS NOT NULL AND EXCLUDED.address <> '' THEN EXCLUDED.address ELSE listings.address END`,
          [l.id, l.price, l.surface ?? null, l.commune ?? null, l.rooms ?? null, l.title ?? null, l.url, l.cpe ?? null, JSON.stringify(photos),
           typeof l.lat === "number" ? l.lat : null, typeof l.lng === "number" ? l.lng : null, l.address ?? null, sourceTag, (l as any).etat ?? null]
        );
      })
    );

    // Snapshot de prix : si bien nouveau OU prix changé.
    await Promise.all(
      items
        .filter((l) => {
          const prev = prevPriceMap.get(l.id);
          return prev === undefined || prev !== l.price;
        })
        .map((l) =>
          pool.query(`INSERT INTO listing_snapshots (listing_id, price) VALUES ($1, $2)`, [l.id, l.price])
        )
    );

    // Comparables : bien + €/m² + provenance + delta prix.
    const comparables: Comparable[] = items
      .map((l) => {
        const prev = prevPriceMap.get(l.id);
        const priceDelta = prev !== undefined && prev !== l.price ? l.price - prev : null;
        const priceM2 = l.surface > 0 ? round2(l.price / l.surface) : null;
        return { ...l, priceM2, source: sourceTag, priceDelta };
      })
      .sort((a, b) => (b.priceM2 ?? -1) - (a.priceM2 ?? -1));

    // Finalisation multi-sources : fusion + dédup dans une transaction (verrou de
    // ligne) pour sérialiser les POST atHome/immotop concurrents sur le même run.
    //   sources_pending NULL  => run mono-source : finalisé direct.
    //   sources_pending >= 1  => on décrémente ; 'done' quand le compteur atteint 0.
    // Les stats (panneau d'exclusions) ne sont écrites que par le POST atHome.
    const statsForUpdate = sourceTag === "athome" ? mergedStatsJson : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query<{ results: any; sources_pending: number | null }>(
        `SELECT results, sources_pending FROM runs WHERE id=$1 FOR UPDATE`,
        [runId]
      );
      const existing: Comparable[] = Array.isArray(cur.rows[0]?.results) ? cur.rows[0].results : [];
      const pending = cur.rows[0]?.sources_pending ?? null;
      const merged = mergeRunResults(existing, comparables).sort(
        (a, b) => (b.priceM2 ?? -1) - (a.priceM2 ?? -1)
      );
      const newPending = pending == null ? null : Math.max(pending - 1, 0);
      const finalStatus = newPending == null || newPending <= 0 ? "done" : "running";
      await client.query(
        `UPDATE runs SET
           count = $2, results = $3, stats = COALESCE($4, stats),
           sources_pending = $5, status = $6,
           finished_at = CASE WHEN $6 = 'done' THEN now() ELSE finished_at END
         WHERE id = $1`,
        [runId, merged.length, JSON.stringify(merged), statsForUpdate, newPending, finalStatus]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      throw e;
    }
    client.release();

    return NextResponse.json({ ok: true, comparables: comparables.length });
  } catch (err: any) {
    console.error("[POST /api/ingest]", err);
    return NextResponse.json({ error: err?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
