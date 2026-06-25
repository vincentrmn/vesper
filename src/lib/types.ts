// ---------------------------------------------------------------------------
// Bien brut (annonce). Forké de BBIscout (ex scoring.ts), sans le scoring flip.
// ---------------------------------------------------------------------------
export type Listing = {
  id: string;
  url: string;
  title?: string;
  price: number; // prix affiché
  surface: number; // m²
  commune?: string; // ex: "Luxembourg-Limpertsberg" — sert à résoudre la zone
  cpe?: string; // classe énergétique (A..I) — atHome uniquement
  rooms?: number;
  /** URLs des photos de l'annonce (extraites par n8n, max 6). */
  photos?: string[];
  /** Coordonnées précises + adresse (carte / dédup). */
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  /** Description de l'annonce (relevé de marché). */
  description?: string | null;
  /** Année de construction (atHome `buildingYear` si renseignée). */
  buildYear?: number | null;
  /** État de rénovation (immotop : ga4Condition ; atHome : absent).
   *  `neuf` = programme neuf / en construction (« Nuovo / In costruzione ») —
   *  distinct de `renove` : un neuf n'est PAS un bien rénové (cf. roadmap immotop). */
  etat?: "a_renover" | "habitable" | "renove" | "neuf" | null;
  /** Statut marché : 'sold' = vendu / sous compromis (atHome isSoldProperty). */
  marketStatus?: "active" | "sold";
};

/**
 * Comparable = bien enrichi du €/m² et de sa provenance. C'est ce qui est
 * stocké dans runs.results et affiché dans le tableau de comparables.
 *   source = 'both' => bien retrouvé sur les 2 portails (dédup géo).
 *   altUrl = lien vers l'annonce de l'autre source.
 */
export type Comparable = Listing & {
  priceM2: number | null;
  source: "athome" | "immotop" | "both";
  altUrl?: string;
  /** Variation vs dernière vue (négatif = baisse). null = première apparition. */
  priceDelta?: number | null;
};

// ---------------------------------------------------------------------------
// Critères de recherche (ce qu'atHome/Immotop savent filtrer).
// ---------------------------------------------------------------------------
export type Criteria = {
  propertyType: "apartment" | "house" | "both";
  /** Codes loc atHome sélectionnés via ZonePicker.
   *  Ex : ["L9-luxembourg"] (toute la zone) ou ["L10-belair","L10-merl"]. */
  locCodes?: string[];
  /** Tokens q atHome alignés sur locCodes (calculés côté serveur depuis `zones`). */
  qTokens?: string[];
  /** Inclure les programmes neufs en construction. false (défaut) => exclus. */
  includeNew?: boolean;
  /** Neuf UNIQUEMENT (exclut l'existant). Prioritaire sur includeNew. */
  newOnly?: boolean;
  surfaceMin?: number;
  surfaceMax?: number;
  priceMin?: number;
  priceMax?: number;
  /** Nombre de chambres minimum (atHome `bedrooms_min`). */
  bedroomsMin?: number;
  /** Année de construction min/max (atHome : filtré côté scraper sur la donnée). */
  buildYearMin?: number;
  buildYearMax?: number;
  /** Classes CPE à conserver (atHome). [] (défaut) => aucun filtre CPE. */
  cpeClasses: string[];
  /** Quand on filtre par classes CPE, conserver AUSSI les biens sans note (atHome). */
  includeNoCpe?: boolean;
  /** Sources de scraping. Absent/vide => ['athome']. 'immotop' tenté si webhook configuré. */
  sources?: ("athome" | "immotop")[];
  /** Filtre d'état de rénovation (immotop uniquement, via ga4Condition). Vide => pas de filtre.
   *  `neuf` n'est pas exposé ici comme filtre d'état : le neuf est gouverné par
   *  includeNew/newOnly (cohérence avec atHome). */
  conditions?: ("a_renover" | "habitable" | "renove")[];
  /** Bande énergie Immotop (filtre SERVEUR `classeEnergetica`, cumulatif « cette
   *  qualité et mieux »). null/absent => pas de filtre. Indicatif : Immotop ne
   *  publie pas la classe C-F exacte par bien, seulement ce filtre par bande. */
  immotopEnergy?: "excellente" | "moyenne" | "basse" | null;
};

export type ConfigRow = {
  id: number;
  name: string;
  criteria: Criteria;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_CRITERIA: Criteria = {
  propertyType: "apartment",
  locCodes: ["L9-luxembourg"],
  includeNew: false,
  surfaceMax: 50,
  cpeClasses: [],
};

// ---------------------------------------------------------------------------
// Zones — sélection de localisation. announced_eur_per_m2 = réf. Observatoire.
// ---------------------------------------------------------------------------
export type Zone = {
  id: string;
  parent_id: string | null;
  label: string;
  loc_code: string;
  /** Token atHome nécessaire pour que `loc=` soit respecté. */
  q_code: string | null;
  /** Réf. Observatoire (prix AFFICHÉ €/m²) de la zone. null si inconnue. */
  announced_eur_per_m2: number | null;
  sort_order: number;
};

export type ZoneTree = Zone & {
  quartiers: Zone[];
};

// ---------------------------------------------------------------------------
// Stats d'un run — persistées dans runs.stats (JSONB).
// ---------------------------------------------------------------------------
export type RunStats = {
  totalAtHome: number;
  pagesFetched: number;
  pagesPlanned: number;
  countSold: number;
  countNew: number;
  capped: boolean;
  /** Réconciliation des exclusions (renseignées par /api/ingest). */
  countReceived?: number;
  countIncomplete?: number;
};
