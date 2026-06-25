import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _vesperPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var _vesperSchema: Promise<void> | undefined;
}

export const pool =
  global._vesperPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") global._vesperPool = pool;

/**
 * Schéma Vesper (estimateur). Forké de BBIscout puis dépouillé du flip :
 * pas de scoring/verdict, pas de veille/findings, pas de suivi/playlists,
 * pas de prix-de-revente/propositions. On garde la plomberie source-agnostique :
 * configs · runs · zones · listings · snapshots · comparables (market_samples)
 * · données Observatoire. Migrations idempotentes (ADD COLUMN IF NOT EXISTS).
 */
export function ensureSchema(): Promise<void> {
  if (!global._vesperSchema) {
    global._vesperSchema = (async () => {
      // Recherches sauvegardées (critères de comparables). `scoring` conservé en
      // JSONB nullable pour rétro-compat du déclencheur ; inutilisé côté Vesper.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS configs (
          id          SERIAL PRIMARY KEY,
          name        TEXT NOT NULL,
          criteria    JSONB NOT NULL,
          scoring     JSONB,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // Historique des recherches. results = comparables enrichis (€/m²).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS runs (
          id          SERIAL PRIMARY KEY,
          config_id   INTEGER REFERENCES configs(id) ON DELETE SET NULL,
          config_name TEXT,
          status      TEXT NOT NULL DEFAULT 'running',
          count       INTEGER NOT NULL DEFAULT 0,
          results     JSONB NOT NULL DEFAULT '[]',
          stats       JSONB,
          scoring     JSONB,
          error       TEXT,
          started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          finished_at TIMESTAMPTZ
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (started_at DESC);`);
      // Recherche multi-sources : nb de sources dont on attend encore le POST.
      //   NULL  => run mono-source : finalisé au 1er POST.
      //   >=1   => chaque POST fusionne ses biens + décrémente ; 'done' à 0.
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS sources_pending INTEGER;`);

      // -------------------------------------------------------------------
      // Zones — géographie. Hérité de BBIscout : Lux-Ville + 26 quartiers comme
      // amorce (commune unique du MVP). Le seed NATIONAL (toutes communes /
      // localités atHome via l'API suggest, cf. CLAUDE.md §4) reste à faire.
      //   loc_code = L<level>-<slug>, q_code = hkey atHome (OBLIGATOIRE pour
      //   que `loc=` soit respecté), announced_eur_per_m2 = réf. Observatoire
      //   (prix AFFICHÉ) de la zone.
      // -------------------------------------------------------------------
      await pool.query(`
        CREATE TABLE IF NOT EXISTS zones (
          id                  TEXT        PRIMARY KEY,
          parent_id           TEXT        REFERENCES zones(id) ON DELETE CASCADE,
          label               TEXT        NOT NULL,
          loc_code            TEXT        NOT NULL,
          q_code              TEXT,
          announced_eur_per_m2 NUMERIC,
          sort_order          INT         NOT NULL DEFAULT 0,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      const { rows } = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM zones`);
      if (rows[0].n === 0) {
        await pool.query(`
          INSERT INTO zones (id, parent_id, label, loc_code, q_code, sort_order) VALUES
            ('lux-ville',      NULL,        'Luxembourg-Ville',           'L9-luxembourg',              '33e38b1b',  0),
            ('beggen',         'lux-ville', 'Beggen',                     'L10-beggen',                 '119ebefe',  1),
            ('belair',         'lux-ville', 'Belair',                     'L10-belair',                 'f37c45a0',  2),
            ('bonnevoie',      'lux-ville', 'Bonnevoie',                  'L10-bonnevoie',              'fd3cdbc5',  3),
            ('centre-ville',   'lux-ville', 'Centre-Ville',               'L10-centre-ville',           'a95e09da',  4),
            ('cents',          'lux-ville', 'Cents',                      'L10-cents',                  '4d568d61',  5),
            ('cessange',       'lux-ville', 'Cessange',                   'L10-cessange',               'a7f77075',  6),
            ('clausen',        'lux-ville', 'Clausen',                    'L10-clausen',                'b4ebf238',  7),
            ('dommeldange',    'lux-ville', 'Dommeldange',                'L10-dommeldange',            'f20d2a31',  8),
            ('eich',           'lux-ville', 'Eich',                       'L10-eich',                   'c02c656a',  9),
            ('gare',           'lux-ville', 'Gare',                       'L10-gare',                   '08ecb2d2', 10),
            ('gasperich',      'lux-ville', 'Gasperich / Cloche d''Or',   'L10-gasperich-cloche-d-or',  '5c12d5b4', 11),
            ('grund',          'lux-ville', 'Grund',                      'L10-grund',                  'c09d83fb', 12),
            ('hamm',           'lux-ville', 'Hamm',                       'L10-hamm',                   'd0270c69', 13),
            ('hollerich',      'lux-ville', 'Hollerich',                  'L10-hollerich',              '025ab94b', 14),
            ('kirchberg',      'lux-ville', 'Kirchberg',                  'L10-kirchberg',              'dea70e87', 15),
            ('kohlenberg',     'lux-ville', 'Kohlenberg',                 'L10-kohlenberg',             'fece382b', 16),
            ('limpertsberg',   'lux-ville', 'Limpertsberg',               'L10-limpertsberg',           'a2d9b00c', 17),
            ('merl',           'lux-ville', 'Merl',                       'L10-merl',                   '6ee95216', 18),
            ('muhlenbach',     'lux-ville', 'Mühlenbach',                 'L10-muhlenbach',             '67c33ee9', 19),
            ('neudorf',        'lux-ville', 'Neudorf',                    'L10-neudorf',                '77eec8cb', 20),
            ('pfaffenthal',    'lux-ville', 'Pfaffenthal',                'L10-pfaffenthal',            '7eed7bed', 21),
            ('pulvermuhle',    'lux-ville', 'Pulvermühle',                'L10-pulvermuehle',           'f29b2f97', 22),
            ('rollingergrund', 'lux-ville', 'Rollingergrund',             'L10-rollingergrund',         'f9c49c4e', 23),
            ('verlorenkost',   'lux-ville', 'Verlorenkost',               'L10-verlorenkost',           'afa0f7d6', 24),
            ('weimershof',     'lux-ville', 'Weimershof',                 'L10-weimershof',             'c683adc1', 25),
            ('weimerskirch',   'lux-ville', 'Weimerskirch',               'L10-weimerskirch',           'fa0760ad', 26)
        `);
        // Réf. Observatoire (prix AFFICHÉ €/m²) par quartier — base 2025.
        await pool.query(`
          UPDATE zones SET announced_eur_per_m2 = src.v FROM (VALUES
            ('lux-ville', 12362), ('beggen', 10124), ('belair', 14273), ('bonnevoie', 10560),
            ('cents', 8892), ('cessange', 10900), ('clausen', 9960), ('dommeldange', 9990),
            ('eich', 11182), ('gare', 10829), ('gasperich', 12289), ('hamm', 10559),
            ('hollerich', 11406), ('kirchberg', 11407), ('limpertsberg', 11977), ('merl', 11768),
            ('muhlenbach', 11695), ('neudorf', 13601), ('pfaffenthal', 9665), ('pulvermuhle', 10296),
            ('rollingergrund', 11014), ('centre-ville', 11743), ('weimerskirch', 10062)
          ) AS src(id, v) WHERE zones.id = src.id;
        `);
      }

      // -------------------------------------------------------------------
      // Listings — référentiel des biens (PK = id source).
      //   source = portail d'origine ('athome' | 'immotop').
      //   alt_* = 2e annonce du MÊME bien physique (dédup géo, cf. lib/dedup.ts).
      //   etat = état de rénovation (immotop : ga4Condition ; atHome : NULL).
      // L'upsert ne touche jamais first_seen, n'écrase ni des photos existantes
      // par un tableau vide, ni des coordonnées connues par null.
      // -------------------------------------------------------------------
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listings (
          id          TEXT PRIMARY KEY,
          source      TEXT NOT NULL DEFAULT 'athome',
          alt_source  TEXT,
          alt_id      TEXT,
          alt_url     TEXT,
          price       INTEGER,
          prev_price  INTEGER,
          surface     NUMERIC,
          commune     TEXT,
          rooms       INTEGER,
          title       TEXT,
          url         TEXT,
          cpe         TEXT,
          etat        TEXT,
          photos      JSONB NOT NULL DEFAULT '[]',
          lat         DOUBLE PRECISION,
          lng         DOUBLE PRECISION,
          address     TEXT,
          first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // Index de pré-filtrage de la dédup cross-source (par prix ; surface/géo en JS).
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listings_dedup_idx ON listings (price) WHERE lat IS NOT NULL AND lng IS NOT NULL;`
      );

      // Historique de prix : une ligne quand bien nouveau OU prix changé.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listing_snapshots (
          id          SERIAL PRIMARY KEY,
          listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          price       INTEGER NOT NULL,
          seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listing_snapshots_listing_idx ON listing_snapshots (listing_id, seen_at);`
      );

      // -------------------------------------------------------------------
      // Comparables terrain (= base de l'estimation Vesper). Alimenté par les
      // relevés ; sert à la distribution €/m² et au calcul de décote affiché→signé.
      // -------------------------------------------------------------------
      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_samples (
          id              SERIAL PRIMARY KEY,
          listing_id      TEXT,
          source          TEXT NOT NULL DEFAULT 'athome',
          quartier_slug   TEXT,
          price           INTEGER,
          surface         NUMERIC,
          price_m2        NUMERIC,
          cpe             TEXT,
          description     TEXT,
          url             TEXT,
          observed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS market_samples_quartier_idx ON market_samples (quartier_slug, observed_at);`
      );

      // Données Observatoire de l'Habitat (actes notariés = prix SIGNÉ).
      // Croisé avec les comparables affichés → décote affiché→signé (cœur Vesper).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS observatoire_data (
          id                SERIAL PRIMARY KEY,
          dataset           TEXT NOT NULL,
          period            TEXT NOT NULL,
          value_eur_m2      NUMERIC,
          resource_modified TIMESTAMPTZ,
          fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (dataset, period)
        );
      `);
    })();
  }
  return global._vesperSchema;
}

/**
 * Garde-fou : le webhook n8n est fire-and-forget (cf. trigger.ts) et l'app n'a
 * aucun timeout. On bascule en erreur tout run resté « running » > 45 min.
 * Idempotent, sans effet sur les runs terminés.
 */
export async function reapStaleRuns(): Promise<void> {
  await pool.query(
    `UPDATE runs
       SET status = 'error',
           error = 'Délai dépassé : aucune réponse du scraper (n8n) après 45 min. Le run a été clôturé automatiquement.',
           finished_at = now()
     WHERE status = 'running'
       AND started_at < now() - interval '45 minutes'`
  );
}
