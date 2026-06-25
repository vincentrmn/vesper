// S12 — Données Observatoire de l'Habitat (actes notariés, appartements
// existants à Luxembourg-Ville) + calcul de la décote affiché -> signé.
import * as XLSX from "xlsx";
import { pool } from "@/lib/db";

const DATASET_URL =
  "https://data.public.lu/api/2/datasets/prix-de-vente-des-appartements-par-commune/";
const NINE_MONTHS_MS = 9 * 30 * 24 * 3600 * 1000;
export const FALLBACK_DECOTE = 0.065;

type ParseResult = { value: number; period: string };

// Parsing DÉFENSIF : on cherche la ligne "Luxembourg" et la colonne "appartements
// existants / ancien — prix moyen €/m²" par LIBELLÉ (jamais par index). Renvoie
// null proprement si introuvable (le caller bascule en fallback).
function parseActesVille(wb: XLSX.WorkBook, period: string): ParseResult | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
    if (!rows.length) continue;

    // 1) Colonne cible : header mentionnant (existant|ancien) ET (moyen|m²|m2|prix).
    let col = -1;
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      const row = rows[r] || [];
      for (let cI = 0; cI < row.length; cI++) {
        const cell = String(row[cI] ?? "").toLowerCase();
        if (/existant|ancien/.test(cell) && /(moyen|m²|m2|prix)/.test(cell)) {
          col = cI;
          break;
        }
      }
      if (col >= 0) break;
    }
    if (col < 0) continue;

    // 2) Ligne Luxembourg (commune exacte, on évite "Luxembourg-...").
    for (const row of rows) {
      const label = String(row[0] ?? "").trim().toLowerCase();
      const isLux = label === "luxembourg" || label === "luxembourg-ville";
      if (!isLux) continue;
      const raw = row[col];
      const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.,]/g, "").replace(",", "."));
      if (Number.isFinite(value) && value > 1000) return { value: Math.round(value), period };
    }
  }
  return null;
}

/** Télécharge le dernier xlsx Observatoire si plus récent, parse et stocke. */
export async function fetchActesVille(): Promise<{ updated: boolean; value?: number; period?: string; error?: string }> {
  try {
    const meta = await fetch(DATASET_URL, { headers: { Accept: "application/json" } });
    if (!meta.ok) return { updated: false, error: `dataset ${meta.status}` };
    const j: any = await meta.json();
    const resources: any[] = Array.isArray(j?.resources) ? j.resources : [];
    const xlsxRes = resources.filter(
      (r) => /xlsx/i.test(r?.format || "") || /\.xlsx(\?|$)/i.test(r?.url || "")
    );
    if (!xlsxRes.length) return { updated: false, error: "aucune ressource xlsx" };
    xlsxRes.sort(
      (a, b) => new Date(b.last_modified || 0).getTime() - new Date(a.last_modified || 0).getTime()
    );
    const res = xlsxRes[0];
    const resourceModified = res.last_modified ? new Date(res.last_modified) : null;
    const period =
      (String(res.title || "").match(/20\d{2}(?:[-\sTQ]*[1-4])?/) || [])[0] ||
      String(new Date().getFullYear());

    // Déjà à jour ?
    const existing = await pool.query<{ resource_modified: string | null }>(
      `SELECT resource_modified FROM observatoire_data WHERE dataset='actes_ville' ORDER BY fetched_at DESC LIMIT 1`
    );
    const prevMod = existing.rows[0]?.resource_modified ? new Date(existing.rows[0].resource_modified!) : null;
    if (resourceModified && prevMod && resourceModified <= prevMod) {
      return { updated: false };
    }

    const dl = await fetch(res.url);
    if (!dl.ok) return { updated: false, error: `download ${dl.status}` };
    const buf = Buffer.from(await dl.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const parsed = parseActesVille(wb, period);
    if (!parsed) {
      console.error("[observatoire] ligne Luxembourg / colonne existants introuvable dans le xlsx");
      return { updated: false, error: "parsing: ligne/colonne introuvable" };
    }

    await pool.query(
      `INSERT INTO observatoire_data (dataset, period, value_eur_m2, resource_modified, fetched_at)
       VALUES ('actes_ville', $1, $2, $3, now())
       ON CONFLICT (dataset, period) DO UPDATE SET
         value_eur_m2 = EXCLUDED.value_eur_m2,
         resource_modified = EXCLUDED.resource_modified,
         fetched_at = now()`,
      [parsed.period, parsed.value, resourceModified]
    );
    return { updated: true, value: parsed.value, period: parsed.period };
  } catch (e: any) {
    console.error("[observatoire] fetchActesVille", e);
    return { updated: false, error: e?.message || "erreur" };
  }
}

export type Decote = {
  decote: number;
  source: "computed" | "fallback";
  affiche_median: number | null;
  signe: number | null;
  period: string | null;
  fetched_at: string | null;
  reason?: string;
};

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Décote affiché -> signé, bornée [4 %, 12 %], fallback 6,5 % signalé. */
export async function getDecote(): Promise<Decote> {
  const { rows } = await pool.query<{ price_m2: string }>(
    `SELECT price_m2 FROM market_samples
     WHERE observed_at > now() - interval '84 days'
       AND surface BETWEEN 30 AND 70
       AND (cpe IS NULL OR cpe IN ('C','D','E','F'))
       AND price_m2 IS NOT NULL`
  );
  const aff = median(rows.map((r) => Number(r.price_m2)).filter((n) => Number.isFinite(n)));

  const obs = await pool.query<{ value_eur_m2: string; period: string; resource_modified: string | null; fetched_at: string }>(
    `SELECT value_eur_m2, period, resource_modified, fetched_at FROM observatoire_data
     WHERE dataset='actes_ville' AND value_eur_m2 IS NOT NULL ORDER BY period DESC LIMIT 1`
  );
  const o = obs.rows[0];
  const signe = o ? Number(o.value_eur_m2) : null;
  const ref = o ? new Date(o.resource_modified || o.fetched_at) : null;
  const stale = ref ? Date.now() - ref.getTime() > NINE_MONTHS_MS : true;

  if (!aff || !signe || signe <= 0 || stale) {
    return {
      decote: FALLBACK_DECOTE,
      source: "fallback",
      affiche_median: aff,
      signe,
      period: o?.period ?? null,
      fetched_at: o?.fetched_at ?? null,
      reason: !aff ? "pas de comps ville" : !signe ? "pas de donnée Observatoire" : stale ? "Observatoire périmé (>9 mois)" : "",
    };
  }
  const d = Math.max(0.04, Math.min(0.12, 1 - signe / aff));
  return { decote: d, source: "computed", affiche_median: aff, signe, period: o.period, fetched_at: o.fetched_at };
}
