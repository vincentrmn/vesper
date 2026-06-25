// Extraction de mots-clés depuis la description d'une annonce.
// Pur, déterministe, sans dépendance. Appliqué au rendu (la description est dans
// runs.results). Sert à donner un coup d'œil rapide : état, occupation, atouts.
// NB : signal indicatif (texte d'annonce, parfois trompeur) — jamais un fait dur.

type Rule = { label: string; kind: KeywordKind; re: RegExp };
export type KeywordKind = "etat" | "occupation" | "atout" | "environnement" | "statut";

export type Keyword = { label: string; kind: KeywordKind };

// L'ordre compte peu ; les doublons de label sont dédupliqués.
const RULES: Rule[] = [
  // --- État ---
  { label: "Rénové", kind: "etat", re: /r[ée]nov[ée]|refait[\s-]?[àa]?[\s-]?neuf|remis? [àa] neuf|enti[èe]rement r[ée]nov/i },
  { label: "À rénover", kind: "etat", re: /[àa] r[ée]nover|travaux [àa] pr[ée]voir|[àa] rafra[îi]chir|[àa] moderniser|gros ?œuvre/i },
  { label: "Neuf", kind: "etat", re: /\bneuf\b|\bneuve\b|construction neuve|future construction|vefa|en construction|futur projet/i },
  { label: "Bon état", kind: "etat", re: /bon [ée]tat|tr[èe]s bon [ée]tat|excellent [ée]tat|impeccable|cl[ée] en main/i },

  // --- Occupation ---
  { label: "Loué", kind: "occupation", re: /\blou[ée]\b|locataire en place|bail en cours|actuellement lou[ée]|occup[ée] par un locataire/i },
  { label: "Libre", kind: "occupation", re: /libre de suite|libre imm[ée]diatement|libre [àa] la vente|non lou[ée]/i },

  // --- Statut de vente ---
  { label: "Sous compromis", kind: "statut", re: /sous compromis|compromis sign[ée]|option en cours|r[ée]serv[ée]/i },

  // --- Environnement ---
  { label: "Calme", kind: "environnement", re: /\bcalme\b|quartier r[ée]sidentiel|au calme|environnement calme|paisible/i },
  { label: "Verdure", kind: "environnement", re: /verdure|espaces? verts?|proche nature|vue sur la nature|c[ôo]t[ée] jardin/i },
  { label: "Vue", kind: "environnement", re: /vue d[ée]gag[ée]e|vue imprenable|belle vue|vue panoramique/i },
  { label: "Proche commodités", kind: "environnement", re: /proche (?:commerces|[ée]coles|transports|commodit[ée]s|centre)|[àa] proximit[ée] des/i },

  // --- Atouts ---
  { label: "Balcon", kind: "atout", re: /balcon/i },
  { label: "Terrasse", kind: "atout", re: /terrasse/i },
  { label: "Jardin", kind: "atout", re: /jardin/i },
  { label: "Garage", kind: "atout", re: /garage|emplacement int[ée]rieur/i },
  { label: "Parking", kind: "atout", re: /parking|emplacement ext[ée]rieur|place de stationnement/i },
  { label: "Cave", kind: "atout", re: /\bcave\b|cellier/i },
  { label: "Ascenseur", kind: "atout", re: /ascenseur/i },
  { label: "Lumineux", kind: "atout", re: /lumineux|tr[èe]s clair|baign[ée] de lumi[èe]re|grandes? baies/i },
  { label: "Investissement", kind: "atout", re: /investiss|rendement|rentabilit[ée]|id[ée]al investisseur/i },
];

/** Extrait les mots-clés présents dans un texte d'annonce (titre + description). */
export function extractKeywords(text?: string | null): Keyword[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: Keyword[] = [];
  for (const r of RULES) {
    if (seen.has(r.label)) continue;
    if (r.re.test(text)) {
      seen.add(r.label);
      out.push({ label: r.label, kind: r.kind });
    }
  }
  return out;
}

// Surfaces mentionnées dans la description (souvent ≠ surface du champ).
// Best-effort, atHome uniquement (Immotop n'a pas de description en liste).
export type SurfaceInfo = { habitable: number | null; terrain: number | null };
export function extractSurfaces(text?: string | null): SurfaceInfo {
  if (!text) return { habitable: null, terrain: null };
  const num = (m: RegExpMatchArray | null) =>
    m ? Math.round(Number(m[1].replace(/[\s.]/g, "").replace(",", "."))) : null;
  // « surface habitable (de) 123 m² » / « habitable : 123 m² »
  const hab = num(text.match(/surface\s+habitable[^0-9]{0,12}(\d[\d\s.,]*)\s*m²?/i));
  // « terrain (de) 4,5 ares » ou « terrain 600 m² »
  let terrain: number | null = null;
  const tAre = text.match(/terrain[^0-9]{0,14}(\d[\d\s.,]*)\s*(?:ares?|a\b)/i);
  const tM2 = text.match(/terrain[^0-9]{0,14}(\d[\d\s.,]*)\s*m²?/i);
  if (tAre) terrain = Math.round(Number(tAre[1].replace(",", ".")) * 100); // ares → m²
  else if (tM2) terrain = num(tM2);
  return { habitable: hab, terrain };
}
