# Immotop.lu — 2ᵉ source : étude technique & plan (S14)

Étude réalisée le 14/06/2026 **avant toute ligne de prod** (méthode imposée §13).
Tests réels exécutés depuis n8n (IP Railway) via workflows jetables + croisement avec atHome.

---

## 0. TL;DR

- ✅ **Faisable.** immotop.lu = plateforme **Immobiliare.it** (Symfony/PHP, v2.137.5). Une **API JSON interne** (`/api-next/search-list/listings/`) renvoie les annonces structurées, **sans protection anti-bot** (les pages HTML SSR, elles, sont en 403).
- ✅ **Recouvrement réel confirmé et important** : beaucoup de biens sont listés sur les **deux** portails → la dédup est nécessaire (la crainte de Vincent est fondée).
- ⚠️ **L'empreinte `quartier + surface + prix` n'est PAS une clé de fusion sûre** : des immeubles vendent plusieurs lots quasi identiques (même quartier, même surface, même prix). Il faut **lat/lng + surface ±1-2 m² + prix ±2-3 %**, et **ne jamais fusionner deux biens qui collisionnent déjà au sein d'une même source**.
- ⚠️ **Pas de classe CPE** dans le payload liste immotop (atHome la donne via la fiche).

---

## 1. Accès — ce qui marche / ne marche pas

| Cible | Résultat |
|---|---|
| Page HTML SSR (`/vente-appartements/luxembourg/`) | **403** (mur anti-bot, même depuis l'IP Railway) |
| `robots.txt` | 200 (serveur Apache, cookie PHPSESSID ; `Disallow` en italien → plateforme Immobiliare.it) |
| `GET /api-next/geography/autocomplete/?query=…` | **200 JSON** (sans cookie) |
| `GET /api-next/search-list/listings/?…` | **200 JSON** avec les bons params (sinon 500/422) |

**Conséquence** : on n'utilise **pas** le HTML. On tape directement l'API `api-next` en JSON, comme un XHR du front. Pas de cookie requis.

## 2. Contrat de l'API de recherche

```
GET https://www.immotop.lu/api-next/search-list/listings/
```
Headers : UA navigateur + `Accept: application/json` + `X-Requested-With: XMLHttpRequest` + `Referer: https://www.immotop.lu/`.

**Params obligatoires** (sinon 500) :
| Param | Valeur (Luxembourg-Ville, apparts à vendre) | Note |
|---|---|---|
| `idContratto` | `1` | 1 = vente |
| `idCategoria` | `1` | 1 = résidentiel |
| `fkRegione` | `LU_3` | région « Centre » — **requis** (son absence fait planter `getRegion()`) |
| `idProvincia` | `LU_03` | province Luxembourg |
| `idComune` | `47` | **commune Luxembourg-Ville** (scalaire ; mappe sur `cityId`. `idComune[]` → 422) |
| `__lang` | `fr` | langue |
| `path` | `%2Fvente-appartements%2Fluxembourg%2F` | **requis** mais **cosmétique** (ne filtre PAS la géo) |
| `pag` | `1..N` | page (25 résultats/page) |

> Vérifié : `idComune=47` seul → 500 ; `fkRegione=LU_3` seul → 200 (4443, toute la région) ; **chaîne complète `fkRegione=LU_3&idProvincia=LU_03&idComune=47` → 200, count 2573, `firstCity:"Luxembourg"`** ✅.

**Params de filtre** (validés, réduisent bien le `count`) :
- `prezzoMinimo` / `prezzoMassimo` (300–800k → 1270)
- `superficieMinima` / `superficieMassima` (25–75 → 1286)
- `localiMinimo` (pièces min ; ≥2 → 1456)
- `criterio=dataModifica&ordine=desc` (tri par date de modif)

**IDs géo** : via `GET /api-next/geography/autocomplete/?query=Luxembourg` →
`type 0` = région (Centre = `LU_3`), `type 1` = province (`LU_03`), `type 2` = **commune** (Luxembourg = `47`), `type 3` = quartier (ex. Muhlenbach = `1782`). Centre ville : lat 49.6136 / lng 6.12646.

## 3. Shape d'une annonce (`results[].realEstate`)

```
realEstate.id            // 1961939  (id numérique stable)
realEstate.uuid          // "7c8cc534-…"
realEstate.seo.url       // "https://www.immotop.lu/annonces/1961939/"  ← URL canonique
realEstate.contract      // "sale"
realEstate.isNew         // true = programme neuf  → à EXCLURE (équiv. old_build)
realEstate.isProjectLike // true = projet multi-lots (pas un comp unitaire) → EXCLURE
realEstate.price.value   // 1195075 (number)
realEstate.title
realEstate.properties[0] : {
  surface       // "123 m²"  (STRING → parser l'entier)
  rooms         // "3"  (peut être "5+" ou plage "1 - 3" sur les projets → EXCLURE les plages)
  bedRoomsNumber, bathrooms, floor, elevator
  description   // texte complet (FR)
  multimedia.photos[].urls.small   // https://pic.immotop.lu/image/{photoId}/xxs-c.jpg
  location : { address, latitude, longitude, macrozone, city, province, region, nation }
}
realEstate.idGeoHash     // geohash de la position
```

**Photos** : `https://pic.immotop.lu/image/{photoId}/{taille}.jpg`, tailles `xxs-c | s-c | m-c | l-c | xxl`. Le payload liste ne donne que `small` (xxs-c) par photo + le main en small/medium/large.

**⚠️ Pas de champ énergie/CPE** nulle part dans le payload liste (clés `realEstate` et `properties[0]` dumpées intégralement : aucune). → CPE indisponible sans fiche détail.

**Mapping vers notre `Listing`** :
| Listing | immotop |
|---|---|
| `id` | `"immotop-" + realEstate.id` (préfixe pour éviter collision d'id avec atHome) |
| `url` | `realEstate.seo.url` |
| `price` | `realEstate.price.value` |
| `surface` | `parseInt(properties[0].surface)` |
| `commune` | `properties[0].location.macrozone` (quartier) — voir aliases §5 |
| `rooms` | `properties[0].bedRoomsNumber` |
| `cpe` | **null** (absent) |
| `photos` | `properties[0].multimedia.photos[].urls` (large via remplacement de taille) |
| `lat/lng` | `properties[0].location.latitude/longitude` |
| `address` | `properties[0].location.address` (présent ~44 % du temps) |
| `description` | `properties[0].description` |

## 4. Test de recouvrement & dédup (le cœur du §13)

**Méthode** : 344 biens immotop (Lux-Ville, apparts 25–90 m², hors neuf/projets) × 238 biens atHome (même périmètre), normalisés, comparés sur plusieurs clés. lat/lng présent à **100 %** des deux côtés ; adresse 44 % (immotop) / 84 % (atHome).

**Résultats** :
- **65 correspondances cross-source** trouvées (55 sur prix+surface exact, +10 en tolérant ±1 m²/±1,5 %/<150 m), malgré des fenêtres d'échantillon non alignées → **recouvrement substantiel**, dédup indispensable.
- **Précision de `prix+surface` seul : insuffisante.** Sur 55 matches, plusieurs faux positifs (biens différents, même prix+surface) — ex. `650000/80m²` apparié entre Bonnevoie et **Beggen, distance 5089 m**. La **distance géo discrimine proprement** : les vrais doublons ont la **même adresse et dist 0–250 m** ; les faux ont dist > 1 km + macrozone différente.
- **Aucune clé n'est unique** (collisions intra-source) :

  | Clé | collisions intra immotop | intra atHome |
  |---|---|---|
  | `quartier + surface + prix` | 36 | 5 |
  | `adresse + surface + prix` | 8 | 7 |
  | `prix + surface` | 44 | 14 |

  Cause : immeubles à lots identiques. Ex. **`110 Rue des Muguets`** : **1 annonce immotop ↔ 4 lots atHome distincts** (46-47 m² / 560 000 €). Les deux portails **agrègent différemment** (immotop regroupe parfois, atHome détaille).
- **Tolérances mesurées (même bien, deux sources)** : surface diffère de **±1 m²** (arrondis), prix de **quelques %** (relist / petite baisse). Ex. `58 rue Raoul Follereau` 80 vs 81 m² ; `2` vs `11 Rue Leonardo da Vinci` 59 vs 60 m², 780k vs 775k.

### Règle de dédup recommandée (révise la règle initiale de §13)

Deux annonces désignent le **même bien physique** si **toutes** ces conditions :
1. **haversine(lat,lng) < 150 m** (clé maîtresse, dispo à 100 %),
2. **|surface| ≤ 1–2 m²**,
3. **|prix| ≤ 2–3 %**.

Garde-fous :
- **Ne jamais fusionner deux biens qui partagent déjà l'empreinte au sein d'une même source** (immeuble multi-lots) : on garde les lots séparés.
- Fusion **1↔1 uniquement** ; si plusieurs candidats (immeuble), apparier par `rooms` + surface la plus proche, sinon **ne pas fusionner** (conserver les deux, signalés « même immeuble, lot incertain »).
- Conserver **les deux `id` et `url`** sur l'enregistrement fusionné ; choisir le **plus riche** (atHome apporte souvent CPE + adresse ; immotop apporte la couverture des biens absents d'atHome).

> `quartier_slug` n'est **pas** la clé de dédup (granularité différente, macrozones composées). Il reste utile pour le prix de revente par zone et le bucketing des comps.

## 5. Macrozones immotop → quartiers (aliases à ajouter)

immotop emploie des macrozones, parfois **composées** :
`Bonnevoie-Verlorenkost`, `Neudorf-Weimershof`, `Gasperich-Cloche d'or`, `Ville Haute`, plus les simples (Belair, Merl, Cents, Muhlenbach, Hollerich, Gare, Cessange, Kirchberg, Limpertsberg, Beggen, Dommeldange, Eich, Hamm, Pfaffenthal, Rollingergrund, Weimerskirch).

À ajouter à `SLUG_ALIASES` (`zones.ts`) : `ville-haute → centre-ville`, `bonnevoie-verlorenkost → bonnevoie`, `neudorf-weimershof → neudorf` (ou découpage géo). `gasperich-cloche-d-or → gasperich` existe déjà. (Mapping non critique car la dédup repose sur la géo.)

## 6. Plan d'implémentation proposé (à valider avant de coder)

**Étape 1 — Scraper immotop (n8n)** : nouveau workflow `BBIscout — immotop scraper`, webhook dédié (ex. `scout-immotop`). Pagination api-next (25/page), exclusion `isNew`/`isProjectLike`/rooms-plage, normalisation au shape `Listing`, POST vers `/api/ingest` avec un champ **`source: "immotop"`**.

**Étape 2 — App : colonne `source` + dédup à l'ingest** :
- `listings` : `ADD COLUMN source TEXT DEFAULT 'athome'`, + colonnes pour le doublon (`alt_source`, `alt_id`, `alt_url`), + `lat/lng` déjà présents.
- À l'ingest : pour chaque bien entrant, chercher un bien actif **proche (géo<150 m) + surface±2 + prix±3 %** ; si trouvé → **fusionner** (enrichir, garder les deux refs) ; sinon → upsert normal. Index géo (bbox sur lat/lng) pour la recherche rapide.
- Garde-fou multi-lots : pas de fusion si collision intra-source.

**Étape 3 — Câblage** : déclencheur immotop dans la veille + le relevé de marché (survey) ; `market_samples` accepte `source` et `cpe=null`.

**Décisions à trancher avec Vincent** :
- **Périmètre du 1er jet** : (a) immotop **partout** (recherche + suivis + survey, avec dédup complète dans `listings`) ; ou (b) commencer par **comps-only** (immotop alimente seulement `market_samples` pour le prix de revente, dédup légère) puis étendre.
- **CPE immotop** : accepter `null` (immotop ne filtre/scoring pas sur CPE) ; OU ajouter une passe « fiche détail » plus tard pour récupérer le CPE (coûteux : 1 req/bien).
- **Seuils de dédup** : 150 m / ±2 m² / ±3 % (valeurs recommandées, ajustables).

## 7. Annexe — paramètres reproductibles

URL de référence (Lux-Ville, apparts anciens 25–75 m², triés par date) :
```
https://www.immotop.lu/api-next/search-list/listings/?idContratto=1&idCategoria=1&fkRegione=LU_3&idProvincia=LU_03&idComune=47&__lang=fr&path=%2Fvente-appartements%2Fluxembourg%2F&superficieMinima=25&superficieMassima=75&criterio=dataModifica&ordine=desc&pag=1
```
Workflows jetables de l'étude (archivés après coup) : probe v1→v8 + overlap v1/v2.

---

## 8. État livré (S14, 14/06/2026)

Pipeline immotop **parallèle et isolé** implémenté (atHome inchangé).

**n8n** : workflow **`BBIscout — immotop scraper`** (`xPqCQVlzP8h1BYuN`), **actif**, webhook
`POST /webhook/scout-immotop`. Scrape api-next (Lux-Ville, exclut neuf + projets),
normalise au shape `Listing` (photos en taille `xxl`, `cpe:null`), POST vers `/api/ingest-immotop`.
Testé isolément (runId bidon, ingest noop) : sortie conforme.

**App** :
- `db.ts` : `listings.source` (`'athome'` défaut | `'immotop'`) + `alt_source/alt_id/alt_url` + index dédup ; `market_samples.source` ; `runs.is_immotop`.
- `lib/dedup.ts` : haversine + `findDuplicate` (géo<150 m + surface±2 + prix±3 %, fusion 1↔1, jamais sur collision intra-source).
- `lib/trigger.ts` : `triggerImmotopRun` (no-op si env absent).
- `app/api/ingest-immotop/route.ts` : route **distincte**, dédup → soit rattache l'annonce immotop à un bien atHome (enrichit, `alt_*`, pas de comp), soit upsert `source='immotop'` + snapshot + scoring (DEFAULT_SCORING) + finding GO/NÉGOCIER + comp (`market_samples`, cpe null).
- Veille (`/api/cron/run-all`) déclenche aussi immotop (best-effort, isolé).
- Suivis : badge `immotop` / `aussi immotop ↗`.

**⚙️ À FAIRE par Vincent (Railway, service Next.js)** : poser la variable
```
N8N_IMMOTOP_WEBHOOK_URL = https://n8n-production-8929d.up.railway.app/webhook/scout-immotop
```
Tant qu'elle est absente, immotop est **désactivé** (no-op) et atHome tourne normalement.

**Suite possible** : extraire le CPE depuis la description (« Isolation thermique: X » vu dans les annonces) ; badge source aussi sur la carte ; cadence (aujourd'hui quotidienne via la veille).

## 9. Recherche manuelle multi-sources (S14, complément)

Le formulaire de recherche permet désormais de choisir les **sources** (atHome / immotop / les deux). Une recherche lance les scrapers choisis sur **le même run**, et les résultats sont **fusionnés + dédupliqués + tagués source** (`atHome` / `immotop` / `atHome + immotop`).

- `Criteria.sources` (`['athome','immotop']` par défaut). immotop n'est tenté que si `N8N_IMMOTOP_WEBHOOK_URL` est configuré, sinon ignoré (atHome seul).
- `runs.sources_pending` : compteur de sources attendues. NULL = run mono-source historique (atHome, veille, anciennes configs) → **comportement strictement inchangé**, finalisé au 1er POST.
- Le scraper immotop est généralisé : filtres quartier (`quartierSlugs`), type (appart/maison), neuf, prix, surface ; il POSTe avec `source:'immotop'` vers l'`ingestUrl` fourni (`/api/ingest` pour la recherche, `/api/ingest-immotop` pour la veille).
- Workflow n8n actif : `BBIscout — immotop scraper` (`mujtQeVNtxpTevor`), webhook `scout-immotop`.
- `/api/ingest` est rendu source-aware : id immotop préfixé (`immotop-<id>`), fusion dans une transaction à verrou de ligne (sérialise les POST atHome/immotop concurrents), `stats` du panneau d'exclusions écrites par le seul POST atHome.
- Badge source : page de résultats + Suivis.

**Limite connue v1** : la dédup *référentielle* (table `listings`) reste portée par `/api/ingest-immotop` (veille). Dans un run de recherche manuel, un bien présent sur les deux portails est fusionné **dans les résultats** (1 ligne, source `both`), mais peut exister en double dans `listings` (1 ligne atHome + 1 ligne `immotop-…`). Invisible à l'usage (le suivi épingle le primaire atHome). À unifier si besoin.

## 10. CPE & état de rénovation immotop (S14, complément)

**CPE exact : indisponible.** immotop n'expose pas la classe énergétique par bien, et son filtre énergie (`classeEnergetica=<id>`, scalaire) est une **bande cumulative** (High/Medium/Low « et mieux »), pas un C-F précis. On ne reproduit donc pas le filtre CPE fin d'atHome. *(Couverture du CPE dans la description : ~8 % seulement → piste écartée. Fiche détail JSON : 500, indisponible.)*

**État de rénovation : disponible nativement** — c'est le levier immotop pour BBI.
- **Filtre** : param **`stato=<id>`** (scalaire ; champ `conditionsId`). Mapping (confirmé via `ga4Condition` des résultats) :
  `1` = Neuf · `2` = Habitable (Buono/Abitabile) · `5` = **À rénover** (Da ristrutturare) · `6` = Rénové (Ottimo/Ristrutturato).
- **Par bien** : **`properties[0].ga4Condition`** donne l'état (présent ~44 % du temps) → renseigne `etat` (`a_renover|habitable|renove`) **sans LLM**.

**Implémenté (S14)** :
- `Listing.etat`, `listings.etat`, `Criteria.conditions`.
- Scraper immotop : lit `ga4Condition→etat` ; filtre condition = scrape par `stato` (par état sélectionné) + dédup id ; param scalaire donc un scrape par condition.
- `triggerRun` mappe `conditions` → `statoIds` (5/2/6).
- Formulaire : sélecteur « État du bien » (À rénover / Habitable / Rénové) — **appliqué à immotop uniquement** (atHome n'a pas la donnée).
- Badge état (résultats + Suivis) ; `market_samples.etat` immotop depuis `ga4Condition` (LLM en fallback si absent).

**Bandes énergie Immotop (S14)** : param `classeEnergetica=<id>`, **cumulatif** (« cette qualité et mieux »), libellés confirmés via `seoData.title` :
`1` = Excellente (1013) · `5` = Moyenne (1102) · `3` = Basse (1296) · (absent = toutes, 1683). Exposé en sélecteur « Énergie · Immotop » (Toutes/Excellente/Moyenne/Basse). **Pas une classe C-F exacte** — indicatif.

**Formulaire (S14)** : on choisit d'abord la/les **source(s)**, puis le reste apparaît ; filtres regroupés par source — section atHome (classes CPE), section Immotop (énergie en bandes + état). « Immotop » avec majuscule.
