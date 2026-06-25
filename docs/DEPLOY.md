# Déploiement Vesper — Railway + n8n

> Je (Claude) **n'ai pas accès à Railway** depuis la session — la création du projet est manuelle (one-shot). Tout le reste (code, schéma DB auto, scraper n8n) est prêt. Suis les étapes dans l'ordre.

## 1. Postgres + service Next (Railway)

1. Railway → **New Project** → **Deploy from GitHub repo** → `vincentrmn/Vesper` (branche `main`).
2. Dans le projet : **+ New** → **Database** → **Add PostgreSQL**.
3. Sur le service **Vesper** (Next), onglet **Variables** :

| Variable | Valeur | Note |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | référence le plugin Postgres |
| `INGEST_SECRET` | une chaîne au hasard | partagé app ↔ n8n |
| `N8N_WEBHOOK_URL` | `https://n8n-production-8929d.up.railway.app/webhook/vesper-search` | scraper atHome (cf. §3) |
| `N8N_IMMOTOP_WEBHOOK_URL` | *(laisser vide pour l'instant)* | Immotop : à brancher plus tard |
| `PUBLIC_APP_URL` | l'URL publique du service (ex. `https://vesper-production-xxxx.up.railway.app`) | renseigner après le 1er deploy, quand l'URL est connue |
| `PGSSL` | *(vide)* | connexion interne Railway |

4. Le schéma DB se crée **tout seul** au 1er appel (`ensureSchema()`), incluant le seed Lux-Ville (26 quartiers). Rien à migrer à la main.
5. Railway redéploie à chaque push sur `main`.

⚠️ `PUBLIC_APP_URL` doit être renseignée **après** avoir l'URL : c'est elle qui fabrique l'`ingestUrl` envoyé à n8n (`${PUBLIC_APP_URL}/api/ingest`). Sans elle, le scraper poste vers une mauvaise URL et aucun comparable ne revient.

## 2. Vérifier le déploiement

- Ouvrir l'URL → le **dashboard** s'affiche (vide au début).
- **+ Nouvelle estimation** → choisir une zone (Lux-Ville ou un quartier), sources, surface/prix → **Enregistrer & lancer**.
- La page run polle ; quand n8n a fini, le **tableau de comparables + distribution €/m²** apparaît.

## 3. Scraper atHome (n8n)

Le scraper atHome est **stateless** : il scrape selon `criteria` et POST vers l'`ingestUrl` que l'app lui envoie à chaque appel. Le contrat (`{runId, secret, listings, stats}`) est identique à celui attendu par `/api/ingest` de Vesper.

**Option A (rapide) — réutiliser le scraper de scout.** Le workflow `zoFcSerIzOatlKTM` (webhook `scout-search`) fonctionne tel quel pour Vesper. Mets `N8N_WEBHOOK_URL = https://n8n-production-8929d.up.railway.app/webhook/scout-search`. Zéro risque, mais le webhook est partagé avec BBIscout.

**Option B (propre) — webhook dédié `vesper-search`.** Cloner `zoFcSerIzOatlKTM` dans n8n, changer le path du nœud Webhook en `vesper-search`, publier. Mets `N8N_WEBHOOK_URL = .../webhook/vesper-search`. À faire quand on veut découpler proprement les deux outils.

> Test isolé du scraper (sans polluer la base, cf. méthode BBIscout) : l'exécuter via MCP avec `runId` bidon et `ingestUrl: https://example.com/noop` — le POST final échoue exprès, mais `get_execution` sur « Scrape SRP » montre les biens scrapés.

## 4. Immotop (plus tard)

Pas de scraper Immotop branché pour le MVP. Le flux est déjà câblé côté app (trigger envoie vers `/api/ingest` taggé `source: immotop`, dédup cross-source au niveau du run). Il manque le **workflow n8n Immotop** (api-next `search-list/listings`, cf. `docs/immotop-source2-etude.md`) + la variable `N8N_IMMOTOP_WEBHOOK_URL`. Tant qu'elle est vide, Immotop est ignoré silencieusement (atHome seul).

## 5. Récap état

- ✅ App Next 14, build OK, déployable.
- ✅ Schéma DB auto + seed Lux-Ville.
- ✅ Pipeline : config → trigger → scrape atHome → ingest (dédup) → comparables + distribution.
- ⏳ **Manuel** : créer le projet Railway + variables (§1), choisir l'option scraper (§3).
- ⏳ Plus tard : seed géo national (CLAUDE.md §4), scraper Immotop (§4), couche Observatoire (Phase 2).
