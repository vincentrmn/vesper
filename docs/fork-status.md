# État du fork BBIscout → Vesper

Démarré le 25/06/2026. Méthode : **copier la plomberie source-agnostique de `scout`, puis dépouiller le flip** (cf. CLAUDE.md §2).

## Repris (plomberie gardée)

| Fichier | Origine scout | Note |
|---|---|---|
| `src/lib/db.ts` | `db.ts` | `ensureSchema()` réduit aux tables utiles (voir ci-dessous). |
| `src/lib/dedup.ts` | `dedup.ts` | **Tel quel.** Dédup cross-source géo<150 m + surface±2 + prix±3 %. |
| `src/lib/observatoire.ts` | `observatoire.ts` | **Tel quel.** `fetchActesVille` + `getDecote` (data.public.lu). |
| `src/lib/zones.ts` | `zones.ts` | `getZoneTree` + `quartierSlug`. Prix-de-revente/centroïdes retirés. |
| `src/lib/types.ts` | `types.ts` + `scoring.ts` | `Listing` rapatrié ici ; nouveau type `Comparable` (= Listing + €/m²). Scoring supprimé. |
| `src/lib/trigger.ts` | `trigger.ts` | `triggerRun` (atHome + Immotop) + `resolveBase`. Survey/relevés flip retirés. |
| `src/app/api/ingest/route.ts` | `ingest/route.ts` | Upsert + snapshots + **dédup cross-source au niveau du run** → comparables. Scoring/findings/proposals retirés. |
| `src/app/api/{trigger,zones,runs,configs}` | idem | Allégés (plus de `scoring` requis pour créer une config). |
| `src/app/{layout,globals.css}`, `search/new/ZonePicker.tsx` | idem | CSS maison **tel quel** ; branding « VESPER ». |
| `src/app/page.tsx`, `search/new/page.tsx`, `runs/[id]/page.tsx` | idem | Dépouillés du scoring/verdict/suivi/photos/carte. Le run affiche **tableau de comparables + distribution €/m²** (Phase 1). |

## Jeté (flip BBIscout)

Scoring (`scoring.ts`, marge/verdict/maxBuyPrice) · prix-de-revente par quartier (`proposals.ts`) · veille/Nouveautés (`findings`, `nouveautes.ts`, cron) · suivi collaboratif (`tracked`, `listing_notes`) · playlists · carte (`PropertyMap`, centroïdes) · Marché vélocité (`market.ts`, sold/gone) · classification LLM (`classify.ts`) · export PDF/Excel · `ingest-immotop` (le flux config-driven Immotop passe par `/api/ingest` taggé `source`).

## Schéma DB conservé

`configs` · `runs` (results = comparables, `sources_pending` multi-sources) · `zones` (géo + `q_code` + `announced_eur_per_m2`) · `listings` (+ `source`/`alt_*`/`etat`) · `listing_snapshots` · `market_samples` (comparables persistés, pour distribution + décote) · `observatoire_data`.

## Reste à faire (par ordre de priorité)

1. **Seed géo national** (CLAUDE.md §4) : script one-shot sur l'API suggest atHome → toutes les communes/localités dans `zones`. Aujourd'hui : seul Lux-Ville (26 quartiers) est seedé comme amorce.
2. **Scrapers n8n** : recréer/adapter les workflows atHome + Immotop (webhooks dédiés) pour qu'ils POSTent vers `/api/ingest`. Variables `N8N_WEBHOOK_URL`, `N8N_IMMOTOP_WEBHOOK_URL`, `INGEST_SECRET`.
3. **Phase 2 — couche Observatoire** : comparatif affiché/signé + fourchette d'estimation bornée + note de confiance (nb comps, dispersion, présence notariale). `observatoire.ts` est déjà en place.
4. **Dédup au niveau référentiel** (DB) : aujourd'hui la dédup cross-source vit au niveau du run (`mergeRunResults`). La rattacher au référentiel `listings` (`alt_*`) comme dans scout `ingest-immotop` si besoin de comparables persistés dédupliqués.
5. **Maisons** : raisonner en prix absolu + fourchette large (le €/m² est trompeur — terrain).

## Infra (cible Railway, cf. CLAUDE.md §7)

Variables : `DATABASE_URL`, `N8N_WEBHOOK_URL`, `N8N_IMMOTOP_WEBHOOK_URL`, `INGEST_SECRET`, `PUBLIC_APP_URL`, `PGSSL`. Build `npm run build` doit passer avant tout commit.
