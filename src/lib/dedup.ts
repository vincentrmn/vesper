// S14 — Dédup cross-source (immotop ↔ atHome).
// Étude §13 (docs/immotop-source2-etude.md) : l'empreinte « quartier + surface +
// prix » N'EST PAS une clé sûre (immeubles à lots identiques → collisions). La
// lat/lng est présente à 100 % des deux côtés ; c'est la clé maîtresse.
//
// Règle (validée sur données réelles) : deux annonces désignent le même bien si
//   distance < ~150 m  ET  |surface| ≤ 2 m²  ET  |prix| ≤ 3 %.
// Garde-fous : fusion 1↔1 uniquement ; si PLUSIEURS biens existants matchent
// (immeuble multi-lots / agrégat de projet), on NE fusionne PAS (on garde le bien
// immotop séparé), car on ne peut pas savoir quel lot c'est.

export const DEDUP_MAX_DISTANCE_M = 150;
export const DEDUP_SURFACE_TOL_M2 = 2;
export const DEDUP_PRICE_TOL_PCT = 0.03;

export type DedupCandidate = {
  id: string;
  price: number | null;
  surface: number | null;
  lat: number | null;
  lng: number | null;
};

export type DedupTarget = {
  price: number | null;
  surface: number | null;
  lat: number | null;
  lng: number | null;
};

/** Distance en mètres entre deux points (haversine). null si une coord manque. */
export function haversineMeters(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined
): number | null {
  const vals = [lat1, lng1, lat2, lng2];
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad((lat2 as number) - (lat1 as number));
  const dLng = toRad((lng2 as number) - (lng1 as number));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1 as number)) *
      Math.cos(toRad(lat2 as number)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** True si `c` et `t` satisfont les trois tolérances (géo + surface + prix). */
export function isSameProperty(c: DedupTarget, t: DedupTarget): boolean {
  if (c.price == null || t.price == null || c.surface == null || t.surface == null) return false;
  const dist = haversineMeters(c.lat, c.lng, t.lat, t.lng);
  if (dist == null || dist > DEDUP_MAX_DISTANCE_M) return false;
  if (Math.abs(c.surface - t.surface) > DEDUP_SURFACE_TOL_M2) return false;
  const dP = Math.abs(c.price - t.price) / Math.max(c.price, t.price);
  return dP <= DEDUP_PRICE_TOL_PCT;
}

export type DedupResult =
  | { kind: "unique"; match: DedupCandidate }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

/**
 * Cherche LE bien existant correspondant à `target` parmi `candidates`.
 *   - "unique"    : exactement un match → fusion sûre.
 *   - "none"      : aucun match → bien neuf.
 *   - "ambiguous" : plusieurs matches (immeuble multi-lots) → NE PAS fusionner.
 */
export function findDuplicate(target: DedupTarget, candidates: DedupCandidate[]): DedupResult {
  if (target.lat == null || target.lng == null || target.price == null || target.surface == null) {
    return { kind: "none" };
  }
  const matches = candidates.filter((c) => isSameProperty(c, target));
  if (matches.length === 1) return { kind: "unique", match: matches[0] };
  if (matches.length === 0) return { kind: "none" };
  return { kind: "ambiguous", count: matches.length };
}
