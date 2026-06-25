# CLAUDE.md — Sextant (BBI estimator)

Contexte persistant du projet. Lu au début de chaque session Claude Code.
Brouillon initial rédigé le 16/06/2026 depuis la session BBIscout (fork du moteur).
Fork du code + scraper n8n dédié réalisés le 25/06/2026 (voir §11 — État d'implémentation).

> **Nom acté : Vesper** (repo `vincentrmn/Vesper`, titre de l'app « Vesper »). Le doc emploie encore « Sextant » par endroits (nom de travail historique) — sans incidence sur le code.

---

## 0. Lis ça d'abord — l'honnêteté méthodologique (NON négociable)

**Sextant estime le prix AFFICHÉ d'un bien à partir d'annonces. Ce n'est PAS un valuateur de prix signé.**

- Les annonces (atHome/Immotop) = **prix demandés**, supérieurs au prix de vente réel.
- La **valeur** (prix signé) ne se lit que dans les **actes notariés** → **Observatoire de l'Habitat** (data.public.lu).
- **Le cœur de l'outil = croiser les comparables affichés avec la référence Observatoire (signée) par commune, et montrer l'écart + la distribution.** Pas un chiffre magique : un **faisceau d'indices** que l'agent (Shawna) interprète.
- Les maisons + les petites communes ont **peu/pas de comparables homogènes** → l'estimation y est **indicative**, jamais une valeur ferme. **Toujours afficher la confiance et le nombre de comps.** Mieux vaut « pas assez de données » qu'un faux prix.
- Leçon héritée de BBIscout (vécue, pas théorique) : les données Immotop sont sales (flag `isNew` non fiable → des neufs classés « rénové » ; pas de CPE accessible). **Ne jamais laisser des annonces non vérifiées piloter un chiffre sans garde-fou prix vs Observatoire.**

Si tu construis un « prix moyen des annonces » sans ce recadrage, tu construis un outil qui ment. Ne le fais pas.

## 1. Le projet en une minute

**Sextant** = outil interne d'**estimation / contexte marché** pour **Shawna** (agente), qui fait beaucoup d'estimations de biens pour ses clients. On configure une recherche (commune, type, surface, chambres, prix…), on scrape **atHome + Immotop**, et on dresse un **tableau de comparables** enrichi d'une **lecture marché** (comparatif Observatoire, moyennes, distribution, décote affiché→signé).

Différent de **BBIscout** (qui cherche des deals achat-rénovation-revente à Lux-Ville). Sextant : **toute la géographie luxembourgeoise, maisons + appartements, pas de scoring de flip**, focus estimation.

## 2. Ce qu'on réutilise de BBIscout (le fork)

~70 % de la plomberie vient de BBIscout (repo `vincentrmn/scout`). À **copier puis dépouiller** :
- **Scrapers n8n** : atHome (SRP + fiche détail CPE) et Immotop (api-next `search-list/listings`). Voir `docs/immotop-source2-etude.md` de BBIscout pour le contrat d'API Immotop complet.
- **Dédup cross-source** (`lib/dedup.ts`) : lat/lng <150 m + surface ±2 + prix ±3 %, jamais de fusion intra-source. À garder tel quel.
- **Ingest** (upsert listings, snapshots, dédup), **Postgres Railway**, **Next 14 App Router**, **CSS maison**.
- **Observatoire** (`lib/observatoire.ts`, data.public.lu) : à **étendre à toutes les communes**.

À **JETER** : tout le scoring de flip (travaux/marge/verdict/maxBuyPrice), les playlists, le suivi collaboratif, la veille de deals, la page Marché vélocité (sauf si réutile plus tard).

## 3. Différences clés vs BBIscout

| | BBIscout | Sextant |
|---|---|---|
| Géo | Lux-Ville (26 quartiers) | **Toutes les communes du Luxembourg** |
| Type | Apparts | **Maisons + appartements** |
| Filtres | type, zone, surface, prix, CPE | + **chambres, salles de bain, terrain, etc.** (tout ce qu'atHome filtre) |
| Sortie | tableau scoré (marge, verdict) | **tableau de comparables + interprétation marché** |
| Immotop | couverture + Nouveautés | **couverture des comparables** (mais pas pour un chiffre officiel — données sales) |
| But | trouver des deals | **estimer / contextualiser une valeur** |

⚠️ **Filtres = uniquement ce qu'atHome expose dans son SRP.** Ne pas inventer de filtres non scrappables. (Immotop a moins de filtres fins ; certains critères ne s'appliqueront qu'à atHome — l'assumer dans l'UI, comme le filtre CPE/état de BBIscout.)

## 4. Géographie — le seed national (RÉSOLU, étude faite le 24/06/2026)

**Bonne nouvelle : le seed des communes atHome est facile.** atHome expose une API de suggestion de localisations (celle de la barre de recherche) :

```
GET https://new-api-lh.prd.athome.lu/lh/v2/suggest?query=<texte>&site=lu_at_home
Headers : UA navigateur + Accept: application/json + Origin/Referer https://www.athome.lu/
→ { code:200, status:"SUCCESS", data:{ locations:{ towns:[ {
     name:"Esch-sur-Sûre", hkey:"1b8a75cf", level:9, slug:"esch-sur-sure",
     levels:{L2:"Luxembourg",L4:"Sud",L9:"Esch-sur-Sûre"},
     slugs:{L2:"luxembourg",L4:"sud",L9:"esch-sur-sure"},
     lat:..., lon:... }, ... ] } } }
```

- **`hkey` = le token `q`** d'atHome (ex. `33e38b1b` pour Luxembourg-Ville). C'était LA question : il est servi directement par l'API.
- **`loc_code` = `L<level>-<slug>`** (ex. `L9-esch-sur-sure`). `level` 9 = commune.
- Bonus : **lat/lon** du centre, et la hiérarchie (L2 pays, L4 canton, L9 commune).
- `site=lu_at_home` est **obligatoire** (valeur exacte ; `athomelu` → 500). Vient de `config.esapi.esapiSite` dans le `__INITIAL_STATE__` du SRP.

**Seed = un script one-shot** : pour chaque commune (liste publique des ~100 communes du Luxembourg, ou en bouclant sur des préfixes), appeler le suggest → insérer dans `zones` (`loc_code`, `q_code=hkey`, `lat`, `lon`, hiérarchie). Pas de scraping page-par-page. Rapide et propre.

Note : le `q` est aussi lisible dans `search.resolvedLocations[].hkey` de n'importe quelle page SRP — fallback si l'API suggest change.

**⚠️ Taxonomie atHome NON uniforme (vérifié 24/06) — finesse localité :**
- atHome descend jusqu'à la **localité** (ex. `Hassel`, `hkey:eb4c7896`, `level:9`), avec sa hiérarchie `{L2:pays, L4:région, L7:commune="Weiler-La-Tour", L9:localité="Hassel"}`. Donc **L7 = commune, L9 = localité.** Sextant peut donc estimer à la maille **localité** (ce que veut Shawna), pas seulement commune.
- **MAIS** les grandes villes sont un cas spécial : **Luxembourg-Ville** est un L9 (la ville) avec ses **quartiers en L10** (Belair, Gasperich). Et le suggest **ne renvoie PAS** ces quartiers (`query=belair` → 0). Pour les quartiers des grandes villes → seed manuel à la BBIscout (les 26 quartiers de Lux-Ville sont déjà seedés dans `scout`).
- **Enumération du seed** : ~600 localités au Luxembourg. Boucler le suggest sur la **liste publique des localités** (ou par préfixes a/b/c…, en dédup sur `hkey`), en filtrant `levels.L2 == "Luxembourg"` (le suggest renvoie aussi DE/BE/FR frontaliers — ex. `Hasselbach` en Allemagne). Pour chaque localité : stocker `q_code=hkey`, `loc_code=L9-<slug>`, le `L7`/commune parent, lat/lon.
- Pour couvrir tous les biens d'une commune d'un coup, on peut aussi chercher atHome en **L7** (`loc=L7-<slug-commune>`) — à vérifier, mais le niveau commune doit agréger ses localités L9.

**Immotop** : geo via `/api-next/geography/autocomplete/?query=<commune>` → `idComune` (type 2) + chaîne parente `fkRegione`/`idProvincia` (cf. `docs/immotop-source2-etude.md`). Mapper chaque commune → ses ids Immotop (un seed similaire).

**Observatoire** : data.public.lu publie par **commune** (prix annoncés + prix de vente notariés). **Actif central de Sextant** — étendre de Lux-Ville à toutes les communes est prioritaire.

## 5. Méthodologie d'estimation (le produit)

Pour une recherche (commune + critères), produire :
1. **Le tableau des comparables** (atHome + Immotop dédupliqués) : prix, €/m², surface, chambres, CPE (atHome), état, lien.
2. **La distribution** : min / P25 / médiane / P75 / max des €/m² (et des prix absolus pour les maisons, où le €/m² est trompeur à cause du terrain).
3. **Le comparatif Observatoire** : prix annoncé moyen commune (affiché) + **prix de vente signé** (notarial) → **l'écart affiché→signé** réel de la commune.
4. **Une fourchette d'estimation** = comparables (médiane/percentile selon le type) × décote affiché→signé locale, **bornée et accompagnée d'une note de confiance** (nb de comps, dispersion, présence de données notariales).
5. **Garde-fous hérités** : plafonner les comparables aberrants vs la réf Observatoire (un comp >> réf = neuf/luxe). Sur les maisons, **ne pas raisonner au m² seul** (terrain). Distinguer affiché vs signé partout.

**Le livrable n'est pas un nombre, c'est un tableau interprété + une fourchette honnête.**

## 6. Pièges connus (hérités de BBIscout — NE PAS REFAIRE)

1. **Immotop `isNew` non fiable** → des neufs se déguisent en « rénové » (état « Ottimo/Ristrutturato » = excellent OU rénové). **Filtrer par PRIX vs Observatoire**, pas par flags.
2. **Pas de CPE Immotop** (fiche derrière mur anti-bot 403, api détail 500). Le CPE n'existe que côté atHome (via fiche détail). Pour un comp « ancien garanti », **CPE C-F = jamais un neuf** (un neuf est A/B).
3. **Affiché ≠ signé** : toujours appliquer/afficher la décote Observatoire.
4. **Maisons** : €/m² trompeur (terrain), comparables hétérogènes → confiance faible, raisonner en prix absolu + fourchette large.
5. **atHome fiche détail** = 1 req/2,5 s → un scrape national large peut être très long ; cadrer (pagination, filtres serveur, garde-fou timeout `reapStaleRuns`).
6. **Immotop sérialise les exécutions n8n** : un gros scrape bloque les suivants.

## 7. Stack & infra (cible, calquée sur BBIscout)

- **Next.js 14 App Router** sous `src/`, CSS maison, Postgres Railway (`ensureSchema()` idempotent), n8n Railway pour les scrapers (webhooks dédiés).
- Déploiement Railway auto sur push `main`. `npm run build` doit passer avant tout commit.
- Variables : `DATABASE_URL`, `N8N_WEBHOOK_URL` (atHome), `N8N_IMMOTOP_WEBHOOK_URL`, `INGEST_SECRET`, `ANTHROPIC_API_KEY` (classification état atHome, optionnel), `PUBLIC_APP_URL`.

## 8. Backlog / phases proposées

- **Phase 0 — Étude** : valider la faisabilité du seed géo national atHome (tokens `q_code` par commune) + le périmètre Observatoire par commune. **Avant de coder** (méthode BBIscout : étude réelle d'abord).
- **Phase 1 — MVP 1 commune** : recherche atHome+Immotop sur UNE commune, tableau de comparables + distribution. Valider le shape.
- **Phase 2 — Couche Observatoire** : comparatif affiché/signé + fourchette d'estimation + confiance.
- **Phase 3 — Généralisation** : toutes communes, maisons, filtres étendus.
- **Phase 4 — Polish** : export (PDF estimation pour le client de Shawna ?), historique des estimations.

## 9. Conventions de travail (reprises de BBIscout)

- **Vincent ne tape aucune commande.** Claude exécute build/git/n8n lui-même.
- **`npm run build` passe avant tout commit.** Jamais de push cassé.
- **Étude + tests réels AVANT de coder les gros morceaux** (le seed géo, le scraping national : on mesure d'abord).
- Branche dédiée → build → commit → PR squash-merge `main` (Railway déploie). Prévenir Vincent quand un batch est fini.
- **Honnêteté directe** sur les limites (surtout : ne jamais survendre la précision d'estimation).
- Français concis, décisions tranchées et justifiées, ne poser que les questions bloquantes.
- Ne pas écrire l'identifiant de modèle dans les commits/PR/code.

## 10. La question à se reposer en permanence

*« Est-ce que ce chiffre, je le mettrais devant le client de Shawna ? »* Si la donnée est trop sale ou trop sparse pour ça → afficher la fourchette + la confiance basse, pas un faux prix précis. **La crédibilité de l'outil tient à ça.**

## 11. État d'implémentation (25/06/2026)

Le fork du code est fait et **buildable** (`npm run build` passe). Détail complet dans `docs/fork-status.md` et déploiement dans `docs/DEPLOY.md`.

**Code (repo, branche `main` + `claude/relaxed-albattani-wrid7z`, synchronisées) :**
- Plomberie reprise de scout puis dépouillée : `db.ts`, `dedup.ts`, `observatoire.ts`, `zones.ts`, `types.ts` (`Listing` + `Comparable`), `trigger.ts` (atHome + Immotop, passe `communeNames` à immotop).
- `/api/ingest` : upsert + snapshots + **dédup cross-source au niveau du run** → comparables (€/m²). Source-aware (`source:immotop`, id préfixé). Pas de scoring/verdict.
- **Features livrées (batch 25/06)** : photos en dépliant (`PhotoStrip` repris de BBIscout) + description + **mots-clés** (`lib/keywords.ts`) ; biens **vendus/sous compromis** inclus + badgés (`listings.market_status`) ; **inclure/exclure** un comparable de l'étude (`runs.excluded_ids`, `/api/runs/exclude`) → distribution recalculée ; **lecture marché** (`/api/estimate`) = écart affiché→signé + fourchette + confiance.
- **Seed géo national FAIT** : `/api/admin/seed-geo` (énum. BFS de l'API suggest atHome, hors-ligne) → **888 zones** (229 communes + 632 localités). ZonePicker a un champ de recherche.
- **⚠️ Token commune = niveau 7 (`urbandistricts`), PAS niveau 9 (`towns`)** — corrigé le 25/06. Le suggest renvoie 2 entrées par commune : `urbandistricts` (L7 = la vraie commune, agrège ses localités) et `towns` (L9). Le seed initial avait pris le L9 ; pour les communes **fusionnées** (Rosport-Mompach, Käerjeng…) ce L9 est un **fantôme à 0 annonce** → recherches vides. Fix : `/api/admin/fix-commune-tokens` a basculé les **101 communes** sur leur token L7 (`docs/commune-l7-tokens.json`, validé : tous > 0). atHome résout la géo **uniquement sur `q`** (le `loc` est cosmétique) → on n'a corrigé que `q_code`, `loc_code` inchangé (configs/ZonePicker préservés). `seed-geo` accepte désormais un bucket `urbandistricts`. Détail : `docs/commune-tokens-fix.md`.
- **Observatoire par commune** : `observatoire.ts` `fetchActesAllCommunes` (data.public.lu, dataset `commune:<slug>`) + `/api/admin/fetch-observatoire` (secret). ⚠️ data.public.lu v2 : `resources` paginées via `href`, fichiers `xls`.

**Scrapers n8n — PROPRES à Vesper (ne PAS réutiliser ceux de BBIscout) :**
- **`Vesper — atHome scraper`**, id **`FvcGpXuWSlMbNDEf`**, webhook **`vesper-search`**. SRP paginé → fiche détail CPE → POST `/api/ingest`. Inclut les vendus (flag `marketStatus`). → `N8N_WEBHOOK_URL`.
- **`Vesper — Immotop scraper`**, id **`zicBduU8x89HnZOD`**, webhook **`vesper-immotop`**. api-next : géo par `geography/autocomplete` (par commune), pagination `search-list/listings` (**param `path=/vente-appartements/<commune>/` REQUIS** + Referer correspondant), normalisation Listing (photos `xxl`, `etat` ga4Condition, pas de CPE), POST `source:immotop`. v1 **appartements**. → `N8N_IMMOTOP_WEBHOOK_URL`.
- ⚠️ **L'api-next immotop a dérivé depuis l'étude de juin** : les params seuls 500ent ; il faut le param `path` + le `Referer` de la même page. Source SDK des deux dans `n8n/`.
- **⚠️ Type de bien immotop = `idTipologia`, PAS `idCategoria` ni le `path`** (corrigé 25/06). `idCategoria=1` = tout le **résidentiel** (apparts + maisons) et le `path` (`/vente-appartements/`) est **cosmétique** (ne filtre pas). Le scraper ne filtrait donc rien → une recherche appartements à Frisange sortait 13+ maisons. Filtre réel = `idTipologia[]` : **4**=appartement, **5**=penthouse, **7**=maison (indiv.+jumelée), **12**=villa (28=terrain). Le scraper mappe `propertyType` → `TIPO` (apartment=[4,5], house=[7,12], both=[4,5,7,12]) et pose `path` cohérent (`vente-maisons` pour house). Vérifié : Frisange appart → 49 biens, 0 maison.
- **Matrice des filtres immotop (étude api-next complète, 25/06) :** `superficieMinima/Massima` ✅ et `prezzoMinimo/Massimo` ✅ filtrent **côté serveur**. **État** (rénové/habitable/à rénover) : **aucun param serveur** ne marche (`stato/idStato/statoImmobile` ignorés ou 500), MAIS `re.ga4Condition` est dans la réponse liste (« Nuovo / In costruzione », « Ottimo / Ristrutturato », « Da ristrutturare ») → le scraper **filtre côté client** via `mapEtat` + `c.conditions` (vérifié : `conditions=["renove"]` → 42/42 rénové). **Énergie / CPE : ABSENTS de la réponse liste ET aucun param ne filtre** → pas de filtre énergie pour immotop (le sélecteur a été retiré du formulaire ; `immotopEnergy` supprimé de `Criteria`). **Pagination** : 25 biens/page, `count`+`maxPages` fiables. **Vendu/compromis** : non exposé par immotop → `marketStatus:'active'` toujours (seul atHome a le statut vendu). Le trigger passe désormais `conditions` (et non plus `statoIds`/`energyId`) au scraper.
- **⚠️ Recherche NEUF (`newOnly`) — ne PAS re-filtrer sur `a.isNewBuild`** (corrigé 25/06). L'URL SRP filtre déjà `new_build=true` côté serveur, mais le flag par-bien `a.isNewBuild` est NON FIABLE (sur une recherche `new_build=true`, ~50 % des biens ressortent `isNewBuild:false`). L'ancien filtre client `if(!a.isNewBuild) continue` jetait donc tous les neufs → `totalAtHome>0` mais 0 gardé (run vide). Le scraper ne re-filtre plus en mode `newOnly` ; il garde les `countNew` écartés uniquement quand `!includeNew`.
- **⚠️ Ingest robuste aux données sales** (corrigé 25/06) : Immotop renvoie parfois `rooms` en fourchette (« 2 - 3 ») → l'INSERT (colonne INTEGER) cassait tout le batch (500, run bloqué). `/api/ingest` coerce désormais tous les champs numériques (`rooms`→1ᵉʳ entier|null, prix/surface validés-arrondis) et fait les upserts en `Promise.allSettled` (un bien sale n'annule plus le lot).

**Déploiement Railway — FAIT (live le 25/06/2026) :**
- **URL : https://vesper-production-d0b8.up.railway.app** — testée end-to-end (recherche → scrape → ingest → comparables OK, run #1 = 18 comps).
- Projet `Vesper` (`eb8ed587-8da4-4835-8dde-4c5a55a03176`), workspace perso (`14f4e15d-…`), env `production` (`d176e079-…`).
- Service **`vesper`** (Next, depuis GitHub `vincentrmn/Vesper` branche `main`, auto-deploy) + domaine ci-dessus.
- Service **`Postgres`** (image `ghcr.io/railwayapp-templates/postgres-ssl:16`) + volume `/var/lib/postgresql/data`. `DATABASE_URL` du service référencé par l'app via `${{Postgres.DATABASE_URL}}`.
- Variables app posées : `DATABASE_URL`, `INGEST_SECRET`, `N8N_WEBHOOK_URL` (→ `vesper-search`), `N8N_IMMOTOP_WEBHOOK_URL` (→ `vesper-immotop`), `PGSSL=require`, `PUBLIC_APP_URL`.
- ⚠️ Pilotage Railway depuis Claude **uniquement en GraphQL direct** (`backboard.railway.com`, `Authorization: Bearer <token>`). La CLI/MCP Railway rejettent ce token (workspace token, user-scoped). L'environnement Claude doit **autoriser l'egress vers `backboard.railway.com`**.
- **Routes admin (one-shot, secret = `INGEST_SECRET`)** : `POST /api/admin/seed-geo {secret,towns[]}` (re-seed géo) ; `POST /api/admin/fetch-observatoire {secret}` (réimport Observatoire).

### Sprint 1 — session du 25/06/2026 (fixes & design, tout livré + déployé)

**Scrapers / données (n8n live patchés + publiés, sources SDK sync) :**
- **atHome recherche à 0 résultat ne plante plus** (#1143) : `GET fiche detail` en `onError:continueRegularOutput` + `Extrait CPE` détecte le sentinelle `_empty` via l'item source apparié → run finalisé `done`.
- **atHome NEUF (`newOnly`)** : on ne re-filtre plus sur `a.isNewBuild` (flag non fiable, ~50 % faux) — l'URL `new_build=true` suffit. Avant : `totalAtHome>0` mais 0 gardé.
- **Tokens commune L9→L7** (cf. ci-dessus) : 101 communes corrigées.
- **Immotop type de bien** : filtre réel = `idTipologia` (4/5 appart, 7/12 maison), plus `idCategoria`/`path`. Fini les maisons en recherche appartements.
- **Immotop état** : filtré **côté scraper** sur `ga4Condition` + `criteria.conditions` (pas de param serveur). Filtre énergie immotop **retiré** (donnée absente).
- **Ingest robuste** : coercition `rooms`/prix/surface + `Promise.allSettled` (plus de 500 sur donnée sale).
- **Dédup niveau 2** (`lib/dedup.ts`) : prix+surface quasi identiques → fusion jusqu'à 800 m (géocodage cross-portail divergent).

**App / UX :**
- **Carte « Analyse » refaite** : chemin Affiché → décote → Signé + 2 encarts en vraies phrases (lecture + « d'où vient la confiance », `confParts` exposé par `/api/estimate`).
- **Export** : logos Excel/PDF + barre de chargement.
- **Trigger** : Immotop **non interrogé si `newOnly`** (ne sait pas filtrer le neuf) ; passe `conditions` (plus `statoIds`/`energyId`).
- **Mobile** : carte de comparable réordonnée (titre puis « Inclure » labellisée), options export empilées, étiquettes de distribution dégroupées.

**Design « BBI tools » (base posée) :**
- Système `.ds-*` dense pro dans `globals.css` + vitrine **`/style`** (additif, aucune page migrée). Doc de référence : **`docs/BBI-tools-design.md`**.
- Outils branchés : skill **ui-ux-pro-max** (actif) + MCP **magic** 21st.dev (à charger au redémarrage). Décisions : CSS maison + primitives, Vesper d'abord, dense pro clair, accent vert BBI.

### Roadmap (priorisée — validée Vincent 25/06)

1. **✅ Creuser Immotop (incohérences persistantes) — RÉGLÉ (session immotop, 2 passes)** — audit api-next complet sur données réelles (Frisange). **Le « 7 vs 4 » de Vincent** : Vesper excluait trop. Distinction clé trouvée : `ga4Condition="Nuovo / In costruzione"` est une **CONDITION d'état** (« comme neuf »), PAS un statut de programme — une unité individuelle neuve reste un comparable existant légitime. Le vrai « Existant » d'immotop ne retire QUE les **programmes promoteur** = `category.id 27` (« immobilier neuf ») / typologie « Projet » (id 276) / `isProjectLike` / titre « programme neuf ». Fix : `isProgram()` (gouverné par `includeNew`, `stats.countNew`), **on n'exclut plus sur `isNew`** (non fiable, vu `true` sur des biens « Buono/Abitabile » existants) **ni sur `ga4=Nuovo`** (= condition). Vérifié en prod : Aspelt → **7** (= immotop), commune → **48** (= immotop). Les unités neuves restent **affichées + badgées `neuf`**.
2. **✅ Localité (gros écart de précision) — RÉGLÉ (session immotop)** — aucun param serveur immotop ne filtre la localité (testé : `idLocalita`/`idMacrozona`/`idMicrozona`/type-3 en `idComune` → 500 ou commune entière). MAIS `properties[0].location.macrozone` **porte fidèlement la localité** (Aspelt / Hellange / « Frisange Localité »). Fix : le scraper **filtre côté client par `macroSlug(macrozone)` ∈ `quartierSlugs`** (déjà envoyés par le trigger pour les localités ET les quartiers Lux-Ville). Vérifié en prod (run live) : recherche Aspelt → 3 biens Aspelt, 19 hors-localité écartés (`stats.countOtherLocality`). Macrozone absente => bien écarté (précision).
3. **✅ Immotop « Rénové » ET « Neuf » — RÉGLÉ (session immotop)** — `mapEtat` mappe désormais « Nuovo / In costruzione » → état **`neuf`** distinct (plus `renove`). Nouveau type `etat:"neuf"` (badge vert) ; le tag « Neuf » (mots-clés titre/desc) est **masqué quand `etat==="neuf"`** → plus de double-badge. `Listing.etat` + UI + export à jour.
   - **Taxonomie type immotop (vérifiée)** : appartement individuel = `idTipologia` **4** (toutes tailles, **studio inclus**) **+ 5** (penthouse). `typology.id` (affichage : 14/15…) ≠ `idTipologia` (filtre). 6=parking, **10=immeuble entier** (investissement, exclu), 12=villa, 16=commerce, 28=terrain. Donc `[4,5]` couvre déjà studio + penthouse + tous les appartements (rien à ajouter).
4. **✅ CPE / énergie Immotop — CLASSE PAR BIEN absente, mais FILTRE PAR BANDE actif (session immotop)** — la **classe C-F par bien** est indisponible (payload liste = zéro clé énergie sauf `ga4Heating`, fiche détail **500**, HTML **403**) → `cpe` reste `null`/« — » dans le tableau. **MAIS le filtre serveur `classeEnergetica` fonctionne** (cumulatif « cette qualité et mieux ») — re-vérifié live : Luxembourg apparts 2035 → **1170** (Excellente). C'est ce que BBIscout exposait ; **re-ajouté** (retiré à tort en S14). `Criteria.immotopEnergy` (excellente/moyenne/basse) → trigger `energyId` (1/5/3) → scraper param `classeEnergetica`. Sélecteur « Énergie · Immotop » dans le formulaire, étiqueté **indicatif (par bandes, pas une classe ferme)**. Ne pas re-supprimer.
5. **🎨 BBI tools design** — session dédiée (voir `docs/BBI-tools-design.md`) : finaliser les primitives puis migrer les écrans Vesper, puis porter sur BBIscout.
6. **Garde-fou comparables aberrants** (plancher surface ~10–15 m² + plafond €/m² vs réf Observatoire) — §0/§5.
7. **Dédup référentielle** immotop↔atHome dans `listings` (aujourd'hui au niveau du run seulement).
8. **Cron de réimport Observatoire**.
