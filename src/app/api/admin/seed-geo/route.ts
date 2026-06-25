import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Slugifie un libellé pour un id de zone stable (sans accents).
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\s/.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

type Town = {
  name?: string;
  hkey?: string;
  level?: number;
  slug?: string;
  lat?: number | string;
  lon?: number | string;
  levels?: Record<string, string>;
};

/**
 * POST /api/admin/seed-geo { secret, towns: Town[] }
 * Seed géo national : insère communes + localités du Luxembourg dans `zones`
 * (depuis l'API suggest atHome, énumérée hors-ligne). Idempotent : ON CONFLICT
 * DO NOTHING (ne touche jamais l'arbre Lux-Ville déjà seedé). Les localités sont
 * rattachées à leur commune (parent_id) quand la commune est connue.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => null);
    const expected = process.env.INGEST_SECRET || "";
    if (expected && body?.secret !== expected) {
      return NextResponse.json({ error: "secret invalide" }, { status: 401 });
    }
    const towns: Town[] = Array.isArray(body?.towns) ? body.towns : [];
    if (!towns.length) return NextResponse.json({ error: "towns requis" }, { status: 400 });

    // Luxembourg uniquement (le suggest renvoie aussi DE/BE/FR frontaliers).
    const lux = towns.filter(
      (t) => t && (t.levels?.L2 === "Luxembourg") && t.hkey && (t.slug || t.name)
    );

    // Dédup par slug.
    const bySlug = new Map<string, Town>();
    for (const t of lux) {
      const slug = slugify(t.slug || t.name || "");
      if (slug && !bySlug.has(slug)) bySlug.set(slug, { ...t, slug });
    }
    const all = [...bySlug.values()];

    // Commune (L7) -> slug de SA propre ville (town dont le nom == son L7).
    const communeSlugByName = new Map<string, string>();
    for (const t of all) {
      const l7 = t.levels?.L7;
      if (l7 && t.name === l7) communeSlugByName.set(l7, t.slug!);
    }

    // Ids déjà présents (ne pas perturber Lux-Ville).
    const existing = new Set<string>(
      (await pool.query<{ id: string }>(`SELECT id FROM zones`)).rows.map((r) => r.id)
    );

    const num = (v: any) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const isLuxVille = (t: Town) => t.levels?.L7 === "Luxembourg" || t.name === "Luxembourg";

    // Un town est une « commune » s'il EST sa commune (name==L7) ou n'a pas de L7.
    const communes = all.filter((t) => !isLuxVille(t) && (!t.levels?.L7 || t.name === t.levels.L7));
    const localites = all.filter((t) => !isLuxVille(t) && t.levels?.L7 && t.name !== t.levels.L7);

    let nbCommunes = 0,
      nbLocalites = 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Pass A — communes (parent null).
      let order = 100;
      for (const t of communes) {
        const id = t.slug!;
        if (existing.has(id)) continue;
        const loc = `L${t.level ?? 9}-${id}`;
        const r = await client.query(
          `INSERT INTO zones (id, parent_id, label, loc_code, q_code, lat, lng, sort_order)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [id, t.name ?? id, loc, t.hkey, num(t.lat), num(t.lon), order++]
        );
        if (r.rowCount) {
          existing.add(id);
          nbCommunes++;
        }
      }
      // Pass B — localités (parent = commune si connue & insérée).
      for (const t of localites) {
        const id = t.slug!;
        if (existing.has(id)) continue;
        const parentSlug = communeSlugByName.get(t.levels!.L7!) ?? null;
        const parent = parentSlug && existing.has(parentSlug) ? parentSlug : null;
        const loc = `L${t.level ?? 9}-${id}`;
        const r = await client.query(
          `INSERT INTO zones (id, parent_id, label, loc_code, q_code, lat, lng, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
          [id, parent, t.name ?? id, loc, t.hkey, num(t.lat), num(t.lon), order++]
        );
        if (r.rowCount) {
          existing.add(id);
          nbLocalites++;
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      throw e;
    }
    client.release();

    const total = (await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM zones`)).rows[0].n;
    return NextResponse.json({
      ok: true,
      received: towns.length,
      luxembourg: all.length,
      inserted: { communes: nbCommunes, localites: nbLocalites },
      zones_total: total,
    });
  } catch (e: any) {
    console.error("[seed-geo]", e);
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}
