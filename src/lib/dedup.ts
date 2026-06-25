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

// Niveau 2 — signal FORT : prix ET surface quasi identiques. Les deux portails
// géocodent souvent différemment (immotop tombe parfois sur le centre commune,
// atHome sur l'adresse) → jusqu'à quelques centaines de mètres d'écart pour le
// MÊME bien. Quand prix+surface coïncident à ce point, on tolère une distance
// plus large (mais bornée au même secteur) pour ne pas rater le doublon.
// Cas réel : maison 800 m² à 4 850 000 € listée sur les 2 sites, géocodée à
// ~260 m d'écart → ratée par le niveau 1 (seuil 150 m).
export const DEDUP_STRONG_DISTANCE_M = 800;
export const DEDUP_STRONG_SURFACE_TOL_M2 = 1;
export const DEDUP_STRONG_PRICE_TOL_PCT = 0.01;

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

/**
 * True si `c` et `t` désignent le même bien physique. Deux niveaux :
 *  - Niveau 1 : proximité serrée (≤150 m) + tolérances usuelles (surface ±2 m²,
 *    prix ±3 %).
 *  - Niveau 2 : prix ET surface quasi identiques (surface ±1 m², prix ±1 %) →
 *    on accepte une distance plus large (≤800 m) pour rattraper les divergences
 *    de géocodage cross-portail.
 * Dans les deux cas la lat/lng des deux côtés est requise (clé maîtresse).
 */
export function isSameProperty(c: DedupTarget, t: DedupTarget): boolean {
  if (c.price == null || t.price == null || c.surface == null || t.surface == null) return false;
  const dist = haversineMeters(c.lat, c.lng, t.lat, t.lng);
  if (dist == null) return false;
  const dSurf = Math.abs(c.surface - t.surface);
  const dP = Math.abs(c.price - t.price) / Math.max(c.price, t.price);
  // Niveau 1 — proximité serrée + tolérances normales.
  if (dist <= DEDUP_MAX_DISTANCE_M && dSurf <= DEDUP_SURFACE_TOL_M2 && dP <= DEDUP_PRICE_TOL_PCT) return true;
  // Niveau 2 — signal fort (prix+surface quasi identiques), distance élargie.
  if (dist <= DEDUP_STRONG_DISTANCE_M && dSurf <= DEDUP_STRONG_SURFACE_TOL_M2 && dP <= DEDUP_STRONG_PRICE_TOL_PCT) return true;
  return false;
}

/**
 * True si `a` et `b` sont la MÊME MAISON re-listée sur la MÊME source. Réservé
 * aux maisons (les appartements ont des lots identiques légitimes → jamais de
 * fusion intra-source). Critère SERRÉ pour ne pas fusionner deux maisons
 * distinctes (vu en prod : 1,10 M€/165 m² ≠ 1,09 M€/167 m²) :
 *   prix quasi EXACT (±0,5 %, un re-listing garde le prix du vendeur) ET soit
 *   - surface quasi exacte (±1 m²)  → marche pour les 2 sources ; OU
 *   - même emplacement (<60 m) quand la géo est fiable (`geoTrust`, = atHome qui
 *     géocode à l'adresse). On NE fait PAS la branche géo pour immotop, qui place
 *     plusieurs maisons au centre de la localité (coords partagées → faux doublons).
 * Le cas atHome surface-divergente (même maison listée 350 puis 450 m²,
 * habitable vs totale, même prix et mêmes coords) est couvert par la branche géo.
 */
export function isSameHouse(a: DedupTarget, b: DedupTarget, geoTrust = false): boolean {
  if (a.price == null || b.price == null) return false;
  const dP = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
  if (dP > 0.005) return false;
  const dS = a.surface != null && b.surface != null ? Math.abs(a.surface - b.surface) : Infinity;
  if (dS <= 1) return true;
  if (geoTrust) {
    const dist = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (dist != null && dist <= 60) return true;
  }
  return false;
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
