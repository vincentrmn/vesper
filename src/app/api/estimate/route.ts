import { NextRequest, NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/db";
import { getCommuneSigned, getDecote } from "@/lib/observatoire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * GET /api/estimate?run=<id>
 * « Lecture marché » d'un run : distribution des comparables affichés retenus,
 * croisée à la réf. Observatoire SIGNÉE de la commune recherchée → écart
 * affiché→signé + fourchette d'estimation signée + note de confiance.
 * Honnêteté (CLAUDE.md §0/§5) : jamais un chiffre seul ; toujours fourchette + confiance.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const runId = req.nextUrl.searchParams.get("run");
    if (!runId) return NextResponse.json({ error: "run requis" }, { status: 400 });

    const runRes = await pool.query<{ results: any; excluded_ids: any; config_id: number | null }>(
      `SELECT results, excluded_ids, config_id FROM runs WHERE id = $1`,
      [runId]
    );
    if (!runRes.rows.length) return NextResponse.json({ error: "run introuvable" }, { status: 404 });
    const { results, excluded_ids, config_id } = runRes.rows[0];
    const excluded = new Set<string>(Array.isArray(excluded_ids) ? excluded_ids : []);
    const comps: any[] = Array.isArray(results) ? results : [];
    const vals = comps
      .filter((c) => !excluded.has(c.id))
      .map((c) => c.priceM2)
      .filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => a - b);

    // Commune recherchée → réf Observatoire signée. On résout via la zone du config.
    let communeSlug: string | null = null;
    let communeLabel: string | null = null;
    if (config_id) {
      const cfg = await pool.query<{ criteria: any }>(`SELECT criteria FROM configs WHERE id = $1`, [config_id]);
      const locCodes: string[] = cfg.rows[0]?.criteria?.locCodes ?? [];
      if (locCodes.length) {
        const z = await pool.query<{ id: string; parent_id: string | null; label: string }>(
          `SELECT id, parent_id, label FROM zones WHERE loc_code = $1`,
          [locCodes[0]]
        );
        if (z.rows.length) {
          const zone = z.rows[0];
          if (zone.parent_id) {
            const p = await pool.query<{ id: string; label: string }>(`SELECT id, label FROM zones WHERE id = $1`, [zone.parent_id]);
            communeSlug = p.rows[0]?.id ?? zone.parent_id;
            communeLabel = p.rows[0]?.label ?? null;
          } else {
            communeSlug = zone.id;
            communeLabel = zone.label;
          }
          // Lux-Ville : id zone = 'lux-ville' mais clé Observatoire = 'luxembourg'.
          if (communeSlug === "lux-ville") communeSlug = "luxembourg";
        }
      }
    }

    const signedRow = communeSlug ? await getCommuneSigned(communeSlug) : null;
    const decote = await getDecote();

    if (vals.length < 3) {
      return NextResponse.json({
        enough: false,
        nComps: vals.length,
        commune: communeLabel,
        signed: signedRow,
        message: "Pas assez de comparables retenus pour une estimation fiable.",
      });
    }

    const displayedMedian = Math.round(percentile(vals, 0.5)!);
    const p25 = Math.round(percentile(vals, 0.25)!);
    const p75 = Math.round(percentile(vals, 0.75)!);
    const min = vals[0], max = vals[vals.length - 1];

    // Décote affiché→signé : si on a le signé commune, on la mesure directement
    // (1 − signé/médiane affichée). MAIS sur une petite commune la réf signée
    // (moyenne 12 mois, peu de ventes) peut être ~égale, voire au-dessus, de la
    // médiane des annonces du run (sous-ensemble étroit) → décote ≈ 0 %, non
    // montrable (CLAUDE.md §0/§10). Garde-fou : si la décote commune mesurée est
    // plus FAIBLE que la décote globale (marché-wide, plus stable), on retient la
    // globale comme plancher et on le signale.
    let decotePct: number;
    let decoteSource: "commune" | "global";
    let decoteReason: string | null = null;
    if (signedRow && signedRow.signed > 0) {
      const measured = 1 - signedRow.signed / displayedMedian;
      if (measured >= decote.decote) {
        decotePct = Math.min(0.25, measured);
        decoteSource = "commune";
      } else {
        // Réf signée commune trop proche des annonces (petite commune / peu de
        // ventes) → on plafonne par le bas avec la décote globale.
        decotePct = decote.decote;
        decoteSource = "global";
        decoteReason = "réf. signée de la commune trop proche des annonces (échantillon réduit) ; décote globale appliquée";
      }
    } else {
      decotePct = decote.decote;
      decoteSource = "global";
      decoteReason = decote.reason ?? null;
    }
    const factor = 1 - decotePct;
    const signedMedian = Math.round(displayedMedian * factor);
    const signedLow = Math.round(p25 * factor);
    const signedHigh = Math.round(p75 * factor);

    // Confiance 0–100 : nb comps · dispersion (P75/P25) · présence du signé commune.
    const sizeScore = Math.min(1, vals.length / 15);
    const spread = p25 > 0 ? p75 / p25 : 3;
    const dispScore = spread <= 1.3 ? 1 : spread <= 1.6 ? 0.8 : spread <= 2 ? 0.6 : 0.4;
    const obsScore = signedRow ? 1 : 0.7;
    let confidence = Math.round(95 * sizeScore * dispScore * obsScore);
    confidence = Math.max(15, Math.min(95, confidence));
    const confLabel = confidence >= 75 ? "Élevée" : confidence >= 55 ? "Bonne" : confidence >= 40 ? "Modérée" : "Faible";

    // Détail lisible des 3 facteurs (pour expliquer la note dans l'UI).
    const sizeLabel = vals.length >= 15 ? "solide" : vals.length >= 8 ? "correct" : "faible";
    const dispLabel = spread <= 1.3 ? "très homogènes" : spread <= 1.6 ? "homogènes" : spread <= 2 ? "assez dispersés" : "très dispersés";
    const confParts = {
      nComps: vals.length,
      sizeLabel,
      spreadPct: Math.round((spread - 1) * 100), // écart P25→P75 en %
      dispLabel,
      hasSigned: !!signedRow,
    };

    return NextResponse.json({
      enough: true,
      nComps: vals.length,
      commune: communeLabel,
      displayed: { min: Math.round(min), p25, median: displayedMedian, p75, max: Math.round(max) },
      signedRef: signedRow, // { signed, period } notarial de la commune (ou null)
      decotePct: Math.round(decotePct * 1000) / 10,
      decoteSource,
      decoteReason,
      estimate: { low: signedLow, median: signedMedian, high: signedHigh },
      confidence,
      confLabel,
      confParts,
    });
  } catch (e: any) {
    console.error("[estimate]", e);
    return NextResponse.json({ error: e?.message ?? "erreur" }, { status: 500 });
  }
}
