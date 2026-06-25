# Workflows n8n — Vesper

Source SDK des workflows n8n (instance `n8n-production-8929d.up.railway.app`).
Le JSON live est la source de vérité ; ces fichiers sont la trace versionnée.

## `vesper-athome-scraper.sdk.js`
- Workflow **`Vesper — atHome scraper`**, id `FvcGpXuWSlMbNDEf`, webhook path **`vesper-search`**.
- Dédié à Vesper (clone du scraper atHome, indépendant de BBIscout).
- Scrape SRP paginé (extraction `__INITIAL_STATE__`, photos, géo, description) → filtre vendu/neuf → fiche détail CPE (1 req/2,5 s) → agrège → POST `{runId, secret, listings, stats}` vers l'`ingestUrl` (= `/api/ingest`).
- Testé en isolation : 20 comparables/page avec CPE+géo. `N8N_WEBHOOK_URL` doit pointer sur `.../webhook/vesper-search`.

## À faire
- Scraper **Immotop** (api-next `search-list/listings`, cf. `docs/immotop-source2-etude.md`) → `N8N_IMMOTOP_WEBHOOK_URL`.

## `vesper-immotop-scraper.sdk.js`
- Workflow **`Vesper — Immotop scraper`**, id `zicBduU8x89HnZOD`, webhook **`vesper-immotop`**.
- api-next immotop.lu : résout la géo par commune via `geography/autocomplete`, pagine `search-list/listings` (param **`path=/vente-appartements/<commune>/` requis** + Referer correspondant), normalise au shape `Listing` (photos `xxl`, `cpe:null`, `etat` depuis `ga4Condition`), POST `source:immotop` vers `/api/ingest`.
- **État `neuf` distinct** : « Nuovo / In costruzione » → `etat:'neuf'` (plus `renove`). **Respecte `includeNew`** : exclut les programmes neufs quand non demandés (cohérence atHome). Détection neuf = `ga4Condition` autoritaire, puis `isProjectLike`/titre/`isNew` en repli (`isNew` seul non fiable).
- **Filtre localité** : pas de param serveur immotop → filtre côté scraper par `macrozone` (= localité) ∈ `quartierSlugs`. Couvre localités nationales ET quartiers Lux-Ville. `stats.countOtherLocality` pour les biens hors-localité écartés.
- **CPE/énergie : indisponible immotop** (acté — payload liste sans énergie, fiche détail 500/HTML 403).
- Trace versionnée via `String.raw` (la source de vérité = le workflow live). v1 = **appartements** (atHome couvre les maisons). `N8N_IMMOTOP_WEBHOOK_URL` → `.../webhook/vesper-immotop`.
