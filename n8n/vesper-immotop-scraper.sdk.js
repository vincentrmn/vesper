import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

const webhookFromApp = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Webhook depuis app', parameters: { httpMethod: 'POST', path: 'vesper-immotop', responseMode: 'onReceived' } },
  output: [{ body: { runId: 1, criteria: {}, ingestUrl: 'https://x', ingestSecret: 'x' } }]
});

// jsCode du noeud Code (n8n `runOnceForAllItems`). String.raw preserve les
// backslashes des regex sans double-echappement. La source de verite reste le
// workflow live (id zicBduU8x89HnZOD) ; ce fichier en est la trace versionnee.
const SCRAPE_CODE = String.raw`const b = $json.body || $json;
const c = b.criteria || {};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
// Slugifie un libelle (macrozone immotop / nom de localite) en id de zone stable.
function slugify(s) {
  return norm(s).replace(/['\s/.]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
// Macrozones immotop parfois composees -> nos ids de zone (miroir de zones.ts).
const MACRO_ALIASES = {
  'ville-haute': 'centre-ville',
  'bonnevoie-verlorenkost': 'bonnevoie',
  'neudorf-weimershof': 'neudorf',
  'gasperich-cloche-d-or': 'gasperich',
  'cloche-d-or': 'gasperich'
};
function macroSlug(s) {
  const k = slugify(s);
  return MACRO_ALIASES[k] || k;
}
async function getJson(url, referer) {
  return await this.helpers.httpRequest({
    method: 'GET', url,
    headers: {
      'User-Agent': UA, 'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': referer || 'https://www.immotop.lu/'
    },
    json: true, returnFullResponse: false
  });
}

// Resout la geo immotop d'une commune via l'autocomplete.
async function resolveGeo(name) {
  const url = 'https://www.immotop.lu/api-next/geography/autocomplete/?query=' + encodeURIComponent(name);
  let arr;
  try { arr = await getJson.call(this, url); } catch (e) { return null; }
  if (!Array.isArray(arr) || !arr.length) return null;
  const nn = norm(name);
  let t = arr.find(x => x && x.type === 2 && norm(x.label) === nn)
       || arr.find(x => x && x.type === 2 && norm(x.label).indexOf(nn) === 0)
       || arr.find(x => x && x.type === 2)
       || arr[0];
  if (!t) return null;
  const parents = Array.isArray(t.parents) ? t.parents : [];
  const prov = parents.find(p => p && p.type === 1);
  const reg = parents.find(p => p && p.type === 0);
  if (!reg) return null;
  return { idComune: t.id, keyurl: t.keyurl, idProvincia: prov ? prov.id : '', fkRegione: reg.id, label: t.label };
}

// Etat de renovation depuis ga4Condition (= CONDITION du bien, pas un statut de
// programme). « Nuovo / In costruzione » = etat 'neuf' (badge), distinct de renove.
const ETAT_MAP = {
  'nuovo': 'neuf', 'incostruzione': 'neuf', 'nuovo/incostruzione': 'neuf',
  'ottimo': 'renove', 'ristrutturato': 'renove', 'ottimo/ristrutturato': 'renove',
  'buono': 'habitable', 'abitabile': 'habitable', 'buono/abitabile': 'habitable',
  'darist': 'a_renover', 'daristrutturare': 'a_renover', 'da_ristrutturare': 'a_renover'
};
function mapEtat(v) {
  const k = norm(v).replace(/[^a-z/]/g, '');
  if (!k) return null;
  if (ETAT_MAP[k]) return ETAT_MAP[k];
  if (k.indexOf('da') === 0 && k.indexOf('rist') >= 0) return 'a_renover';
  if (k.indexOf('nuovo') >= 0 || k.indexOf('costruzione') >= 0) return 'neuf';
  if (k.indexOf('rist') >= 0 || k.indexOf('ottimo') >= 0) return 'renove';
  if (k.indexOf('buono') >= 0 || k.indexOf('abit') >= 0) return 'habitable';
  return null;
}
// Detecte un PROGRAMME PROMOTEUR (neuf groupe / VEFA / projet). C'est EXACTEMENT
// ce qu'immotop retire en « Existant » (category 27 « immobilier neuf » / typologie
// « Projet » id 276 / isProjectLike). On n'exclut QUE ca : une unite individuelle
// en etat neuf reste un comparable existant legitime (affichee + badgee « neuf »).
// On n'utilise NI `isNew` (non fiable) NI `ga4=Nuovo` (= condition d'etat) pour
// exclure. Verifie sur donnees reelles : Aspelt -> 7 (= immotop), commune -> 48.
const PROG_RE = /programme\s+neuf|projet\s+immobilier|nouvelle\s+residence|nouveau\s+projet/i;
function isProgram(re, p, title) {
  const cat = (p.category && p.category.id) || (re.category && re.category.id);
  const typ = (p.typology && p.typology.id);
  return cat === 27 || re.isProjectLike === true || typ === 276 || PROG_RE.test(norm(title));
}
function photosOf(p) {
  const out = [];
  const arr = (p.multimedia && Array.isArray(p.multimedia.photos)) ? p.multimedia.photos : [];
  for (const ph of arr) {
    const u = ph && ph.urls && (ph.urls.small || ph.urls.medium || ph.urls.large);
    if (typeof u === 'string' && u.indexOf('http') === 0) {
      out.push(u.replace(/xxs-c\.jpg$/, 'xxl.jpg').replace(/\/[a-z]+-c\.jpg$/, '/xxl.jpg'));
    }
    if (out.length >= 6) break;
  }
  return out;
}
function parseSurface(v) {
  if (typeof v === 'number') return v;
  const m = String(v || '').replace(/\./g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

const communes = Array.isArray(c.communeNames) && c.communeNames.length ? c.communeNames : ['Luxembourg'];
const idCategoria = 1;
const PT = c.propertyType || 'apartment';
// idTipologia = espace de FILTRE immotop. Appartement individuel = 4 (toutes
// tailles, studio inclus) + 5 (penthouse). Maison = 7 (indiv.+jumelee) + 11
// (ferme) + 12 (villa) — c'est exactement le macro « Maisons » d'immotop.
// 6=parking, 10=immeuble entier, 16=commerce, 28=terrain -> jamais.
const TIPO = PT === 'house' ? [7, 11, 12] : PT === 'both' ? [4, 5, 7, 11, 12] : [4, 5];
const pathSeg = PT === 'house' ? 'vente-maisons' : 'vente-appartements';
// Filtre etat (a_renover/habitable/renove) : pas de param serveur fiable, on filtre
// cote scraper sur ga4Condition (la condition, pas le statut de programme).
const CONDS = Array.isArray(c.conditions) ? c.conditions : [];
const includeNew = !!c.includeNew;
// Filtre localite : quand l'utilisateur cible une localite/quartier (pas la commune
// entiere), immotop ne sait pas filtrer cote serveur -> on filtre sur la macrozone
// (= localite) de chaque bien. Vide => toute la commune.
const QSLUGS = (Array.isArray(c.quartierSlugs) ? c.quartierSlugs : []).map(slugify).filter(Boolean);
const MAX_PAGES = Number(c.maxPages) || 30;
const allBiens = [];
const stats = { totalAtHome: 0, pagesFetched: 0, pagesPlanned: 0, countSold: 0, countNew: 0, countOtherLocality: 0, capped: false };
const seen = {};

for (const commune of communes) {
  const geo = await resolveGeo.call(this, commune);
  if (!geo) continue;
  const path = '/' + pathSeg + '/' + (geo.keyurl || norm(commune)) + '/';
  const referer = 'https://www.immotop.lu' + path;
  let pag = 1, plannedPages = MAX_PAGES;
  while (pag <= MAX_PAGES) {
    const qp = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== '') qp.push(k + '=' + encodeURIComponent(String(v))); };
    add('idContratto', 1); add('idCategoria', idCategoria);
    add('fkRegione', geo.fkRegione); add('idProvincia', geo.idProvincia); add('idComune', geo.idComune);
    add('__lang', 'fr'); add('path', path);
    TIPO.forEach((tp, ti) => qp.push('idTipologia%5B' + ti + '%5D=' + tp));
    add('superficieMinima', c.surfaceMin); add('superficieMassima', c.surfaceMax);
    add('prezzoMinimo', c.priceMin); add('prezzoMassimo', c.priceMax);
    // Bande energie (filtre SERVEUR cumulatif) : 1=Excellente, 5=Moyenne, 3=Basse.
    add('classeEnergetica', c.energyId);
    add('criterio', 'dataModifica'); add('ordine', 'desc'); add('pag', pag);
    const url = 'https://www.immotop.lu/api-next/search-list/listings/?' + qp.join('&');
    let resp;
    try { resp = await getJson.call(this, url, referer); } catch (e) { break; }
    const results = (resp && Array.isArray(resp.results)) ? resp.results : [];
    const count = (resp && Number(resp.count)) || 0;
    if (pag === 1) {
      stats.totalAtHome += count;
      plannedPages = Math.min(Math.ceil(count / 25) || 1, MAX_PAGES);
    }
    for (const item of results) {
      const re = item && item.realEstate;
      if (!re) continue;
      const props = Array.isArray(re.properties) ? re.properties : [];
      const p = props.find(x => x && x.isMain) || props[0] || {};
      const price = re.price && typeof re.price.value === 'number' ? re.price.value : null;
      const surface = parseSurface(p.surface);
      if (!price || !surface) continue;
      const id = String(re.id);
      if (seen[id]) continue; seen[id] = 1;
      const loc = p.location || {};
      // Filtre localite (macrozone) AVANT tout rejet metier.
      if (QSLUGS.length) {
        const mz = macroSlug(loc.macrozone);
        if (!mz || QSLUGS.indexOf(mz) < 0) { stats.countOtherLocality++; continue; }
      }
      const title = (p.caption || re.title || p.typologyGA4Translation || 'Appartement') + '';
      // Programme promoteur exclu si l'utilisateur ne veut pas le neuf (= « Existant »,
      // cohérent avec immotop et avec atHome qui filtre new_build cote serveur).
      if (!includeNew && isProgram(re, p, title)) { stats.countNew++; continue; }
      const etat = mapEtat(re.ga4Condition || p.ga4Condition);
      // Filtre etat demande (a_renover/habitable/renove/neuf).
      if (CONDS.length && (!etat || CONDS.indexOf(etat) < 0)) continue;
      allBiens.push({
        id: id,
        price: price,
        surface: surface,
        commune: loc.city || geo.label || commune,
        rooms: p.bedRoomsNumber || p.rooms || null,
        title: title,
        url: ((re.seo && re.seo.url) || ('https://www.immotop.lu/annonces/' + id + '/')),
        cpe: null,
        photos: photosOf(p),
        lat: typeof loc.latitude === 'number' ? loc.latitude : null,
        lng: typeof loc.longitude === 'number' ? loc.longitude : null,
        address: loc.address || null,
        etat: etat,
        marketStatus: 'active'
      });
    }
    stats.pagesFetched = pag;
    if (results.length < 25 || pag >= plannedPages) break;
    pag++;
    await sleep(350);
  }
  await sleep(250);
}

const ctx = { runId: b.runId, ingestUrl: b.ingestUrl, ingestSecret: b.ingestSecret, source: 'immotop' };
return [{ json: { ...ctx, listings: allBiens, stats } }];
`;

const scrapeImmotop = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Scrape immotop (api-next)', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: SCRAPE_CODE } },
  output: [{ runId: 1, ingestUrl: 'https://x', ingestSecret: 'x', source: 'immotop', listings: [], stats: {} }]
});

const postVersApp = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: { name: 'POST vers app', parameters: { method: 'POST', url: expr('{{ $json.ingestUrl }}'), sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ runId: $json.runId, secret: $json.ingestSecret, listings: $json.listings, stats: $json.stats, source: $json.source }) }}') } },
  output: [{ ok: true }]
});

export default workflow('vesper-immotop-scraper', 'Vesper \u2014 Immotop scraper')
  .add(webhookFromApp).to(scrapeImmotop).to(postVersApp);
