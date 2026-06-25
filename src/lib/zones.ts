import { pool, ensureSchema } from "./db";
import type { Zone, ZoneTree } from "./types";

/** Récupère l'arbre des zones (villes -> quartiers/localités) depuis la base. */
export async function getZoneTree(): Promise<ZoneTree[]> {
  await ensureSchema();
  const { rows } = await pool.query<Zone>(
    `SELECT id, parent_id, label, loc_code, q_code, announced_eur_per_m2, sort_order
     FROM zones
     ORDER BY sort_order ASC, label ASC`
  );
  // pg renvoie NUMERIC en string -> on normalise en number|null.
  const norm = rows.map((r) => ({
    ...r,
    announced_eur_per_m2:
      r.announced_eur_per_m2 === null || r.announced_eur_per_m2 === undefined
        ? null
        : Number(r.announced_eur_per_m2),
  }));
  const cities = norm.filter((r) => r.parent_id === null);
  return cities.map((city) => ({
    ...city,
    quartiers: norm.filter((r) => r.parent_id === city.id),
  }));
}

// Synonymes : libellés de localisation qui ne matchent pas l'id de zone.
// Ex. « Cloche d'Or » fait partie de la zone `gasperich`.
const SLUG_ALIASES: Record<string, string> = {
  "cloche-d-or": "gasperich",
  "gasperich-cloche-d-or": "gasperich",
  // Macrozones immotop (parfois composées) vers nos quartiers.
  "ville-haute": "centre-ville",
  "bonnevoie-verlorenkost": "bonnevoie",
  "neudorf-weimershof": "neudorf",
};

/**
 * Normalise un libellé de commune ("Luxembourg-Limpertsberg") vers l'id de zone
 * ("limpertsberg"). Retire le préfixe ville, les accents, slugifie, puis applique
 * les synonymes connus. Retourne null si vide.
 */
export function quartierSlug(commune?: string | null): string | null {
  if (!commune) return null;
  let s = commune
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // retire les accents
  s = s.replace(/^luxembourg[-\s]+/, "").trim();
  s = s.replace(/['\s/]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!s) return null;
  return SLUG_ALIASES[s] ?? s;
}
