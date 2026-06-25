import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { isSameProperty, isSameHouse } from "@/lib/dedup";
import type { Comparable, Listing, RunStats } from "@/lib/types";

export const runtime = "nodejs";

// Fusion des résultats d'un run multi-sources. `existing` (déjà présents, taggés)
// + `incoming` (une seule source). Dédup cross-source (géo<150m + surface±2 +
// prix±3 %) : un bien retrouvé sur les 2 portails devient source='both' (atHome
// primaire) avec altUrl vers l'autre annonce. Ambigu (multi-lots) => gardé séparé.
//
// `houseMode` (recherche de MAISONS) active EN PLUS la dédup INTRA-source : une
// maison re-listée sur la même source (mêmes prix+surface, ou même prix+emplacement)
// est fusionnée. Pas pour les appartements (lots identiques légitimes en immeuble).
function mergeRunResults(existing: Comparable[], incoming: Comparable[], houseMode: boolean): Comparable[] {
  const out = existing.slice();
  const xy = (c: Comparable) => ({ price: c.price, surface: c.surface, lat: c.lat ?? null, lng: c.lng ?? null });
  for (const inc of incoming) {
    const incSrc = inc.source === "both" ? "athome" : inc.source ?? "athome";

    // Dédup intra-source (maisons) : si un bien de la MÊME source est la même
    // maison, on ne ré-ajoute pas le doublon (on garde le plus riche en photos).
    if (houseMode) {
      const twin = out.findIndex((e) => {
        const eSrc = e.source === "both" ? "athome" : e.source ?? "athome";
        return eSrc === incSrc && isSameHouse(xy(e), xy(inc), incSrc === "athome");
      });
      if (twin >= 0) {
        if ((inc.photos?.length ?? 0) > (out[twin].photos?.length ?? 0)) {
          out[twin] = { ...inc, source: out[twin].source, altUrl: out[twin].altUrl };
        }
        continue;
      }
    }

    const hits: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      const eSrc = e.source === "both" ? "athome" : e.source ?? "athome";
      if (eSrc === incSrc) continue; // même source : pas de fusion cross-source
      if (isSameProperty(xy(e), xy(inc))) hits.push(i);
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

// Coercition défensive — les données scrapées (surtout Immotop) sont sales :
// `rooms` peut être une fourchette (« 2 - 3 »), une chaîne (« 1 ») ou null ;
// prix/surface peuvent arriver en chaîne. Un seul mauvais entier faisait
// planter TOUT le batch (PG « invalid input syntax for type integer »).
/** Nombre fini (accepte un entier/décimal en chaîne pure, "65" ou "64,5"), sinon null. */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(",", ".").trim();
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  }
  return null;
}
/** Entier ou null. Sur une chaîne (« 2 - 3 », « 3 chambres »), prend le 1ᵉʳ entier. */
function intOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === "string") {
    const m = v.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }
  return null;
}

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

    const runRow = await pool.query<{ id: number; criteria: any }>(
      `SELECT r.id, c.criteria FROM runs r LEFT JOIN configs c ON c.id = r.config_id WHERE r.id=$1`,
      [runId]
    );
    if (!runRow.rows.length) return NextResponse.json({ error: "run introuvable" }, { status: 404 });
    // Recherche de maisons → dédup intra-source active (les maisons ne sont pas
    // des lots multiples : une 2e annonce au même prix = le même bien).
    const houseMode = runRow.rows[0]?.criteria?.propertyType === "house";

    const safe = Array.isArray(listings) ? listings : [];

    // Source du POST ('athome' par défaut). Les biens immotop reçoivent un id
    // préfixé pour ne pas entrer en collision avec les ids atHome.
    const sourceTag: "athome" | "immotop" = (body as any).source === "immotop" ? "immotop" : "athome";

    // Normalisation + filtre : prix/surface coercés (un bien sans prix/surface
    // valide est écarté), rooms ramené à un entier (ou null). Robuste aux
    // fourchettes/chaînes Immotop — plus jamais de 500 sur un seul champ sale.
    const items = safe
      .map((l) => {
        if (!l || l.id == null) return null;
        const price = numOrNull((l as any).price);
        const surface = numOrNull((l as any).surface);
        if (price == null || surface == null || surface <= 0) return null;
        return {
          ...l,
          id: sourceTag === "immotop" ? `immotop-${l.id}` : String(l.id),
          price: Math.round(price),
          surface,
          rooms: intOrNull((l as any).rooms) ?? undefined,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    // Réconciliation des exclusions (biens transmis vs rejetés faute de prix/surface).
    const mergedStats: RunStats | null = stats
      ? { ...stats, countReceived: safe.length, countIncomplete: safe.length - items.length }
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
    // allSettled : un bien isolé en échec n'annule plus tout le batch (résilience).
    const upserts = await Promise.allSettled(
      items.map((l) => {
        const photos = Array.isArray(l.photos)
          ? l.photos.filter((p) => typeof p === "string" && p.startsWith("http")).slice(0, 6)
          : [];
        const marketStatus = (l as any).marketStatus === "sold" ? "sold" : "active";
        return pool.query(
          `INSERT INTO listings (id, source, price, surface, commune, rooms, title, url, cpe, photos, lat, lng, address, etat, market_status)
           VALUES ($1, $13, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $14, $15)
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
             market_status = EXCLUDED.market_status,
             address = CASE WHEN EXCLUDED.address IS NOT NULL AND EXCLUDED.address <> '' THEN EXCLUDED.address ELSE listings.address END`,
          [l.id, l.price, l.surface ?? null, l.commune ?? null, l.rooms ?? null, l.title ?? null, l.url, l.cpe ?? null, JSON.stringify(photos),
           typeof l.lat === "number" ? l.lat : null, typeof l.lng === "number" ? l.lng : null, l.address ?? null, sourceTag, (l as any).etat ?? null, marketStatus]
        );
      })
    );
    const upsertFailed = upserts.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (upsertFailed.length) {
      console.error(`[ingest] ${upsertFailed.length}/${items.length} upserts échoués (${sourceTag}) :`, upsertFailed[0].reason?.message ?? upsertFailed[0].reason);
    }

    // Snapshot de prix : si bien nouveau OU prix changé.
    await Promise.allSettled(
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
      const merged = mergeRunResults(existing, comparables, houseMode).sort(
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
