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
