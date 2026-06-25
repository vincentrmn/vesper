import { pool, ensureSchema } from "./db";

export type TriggerResult =
  | { ok: true; runId: number }
  | { ok: false; status: number; error: string; runId?: number };

/**
 * Crée un run pour une config, enrichit les qTokens depuis la table zones, et
 * déclenche le(s) webhook(s) n8n (fire-and-forget). atHome et/ou Immotop selon
 * `criteria.sources` et la disponibilité des webhooks. Les deux sources POSTent
 * leurs biens vers /api/ingest (taggés `source`) ; la dédup cross-source y est
 * faite au niveau du run.
 *
 * @param base Origine publique de l'app (https://host) pour l'ingestUrl.
 */
export async function triggerRun(
  configId: number,
  opts: { base: string }
): Promise<TriggerResult> {
  await ensureSchema();

  const cfg = await pool.query(`SELECT * FROM configs WHERE id = $1`, [configId]);
  if (!cfg.rows.length) return { ok: false, status: 404, error: "config introuvable" };
  const config = cfg.rows[0];

  // qTokens (atHome) + quartierSlugs (immotop), alignés sur locCodes.
  const criteria = { ...(config.criteria || {}) };
  const locCodes: string[] = Array.isArray(criteria.locCodes) ? criteria.locCodes : [];
  let atHomeGeoOk = true;
  let quartierSlugs: string[] = [];
  if (locCodes.length) {
    const zonesRes = await pool.query<{ id: string; parent_id: string | null; loc_code: string; q_code: string | null }>(
      `SELECT id, parent_id, loc_code, q_code FROM zones WHERE loc_code = ANY($1::text[])`,
      [locCodes]
    );
    const byLoc = new Map(zonesRes.rows.map((r) => [r.loc_code, r]));
    const aligned = locCodes.map((lc) => byLoc.get(lc)).filter((z): z is NonNullable<typeof z> => !!z && !!z.q_code);
    criteria.locCodes = aligned.map((z) => z.loc_code);
    criteria.qTokens = aligned.map((z) => z.q_code as string);
    atHomeGeoOk = aligned.length > 0;
    const wholeCity = zonesRes.rows.some((z) => z.parent_id === null);
    quartierSlugs = wholeCity ? [] : zonesRes.rows.filter((z) => z.parent_id !== null).map((z) => z.id);
  }

  // Sources demandées (défaut atHome) filtrées par disponibilité réelle.
  const wanted: string[] =
    Array.isArray(criteria.sources) && criteria.sources.length ? criteria.sources : ["athome"];
  const athomeWebhook = process.env.N8N_WEBHOOK_URL;
  const immotopWebhook = process.env.N8N_IMMOTOP_WEBHOOK_URL;
  const fire: ("athome" | "immotop")[] = [];
  if (wanted.includes("athome") && athomeWebhook && atHomeGeoOk) fire.push("athome");
  if (wanted.includes("immotop") && immotopWebhook) fire.push("immotop");

  if (fire.length === 0) {
    const reason =
      wanted.includes("athome") && !athomeWebhook
        ? "N8N_WEBHOOK_URL non configuré"
        : wanted.includes("athome") && !atHomeGeoOk
        ? "Aucune zone sélectionnée n'a de q_code configuré en base."
        : wanted.includes("immotop") && !immotopWebhook
        ? "immotop sélectionné mais N8N_IMMOTOP_WEBHOOK_URL non configuré."
        : "Aucune source de scraping disponible.";
    return { ok: false, status: 400, error: reason };
  }

  const run = await pool.query(
    `INSERT INTO runs (config_id, config_name, status, sources_pending)
     VALUES ($1, $2, 'running', $3) RETURNING id`,
    [config.id, config.name, fire.length]
  );
  const runId = run.rows[0].id as number;
  const ingestSecret = process.env.INGEST_SECRET || "";

  // atHome : son échec d'envoi reste fatal pour le run (source principale).
  if (fire.includes("athome")) {
    fetch(athomeWebhook!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, criteria, ingestUrl: `${opts.base}/api/ingest`, ingestSecret }),
    }).catch(async (e) => {
      await pool.query(`UPDATE runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [runId, String(e)]);
    });
  }

  // immotop : best-effort. Un échec d'envoi décrémente le compteur (le run se
  // termine avec les seuls résultats atHome) — il ne casse jamais le run.
  if (fire.includes("immotop")) {
    // Filtre d'état -> ids `stato` immotop (à rénover=5, habitable=2, rénové=6).
    const STATO_BY_ETAT: Record<string, number> = { a_renover: 5, habitable: 2, renove: 6 };
    const statoIds = (Array.isArray(criteria.conditions) ? criteria.conditions : [])
      .map((c: string) => STATO_BY_ETAT[c])
      .filter((v: number | undefined): v is number => typeof v === "number");
    // Bande énergie immotop (cumulative) -> id classeEnergetica.
    const ENERGY_BY_BAND: Record<string, number> = { excellente: 1, moyenne: 5, basse: 3 };
    const energyId = criteria.immotopEnergy ? ENERGY_BY_BAND[criteria.immotopEnergy] : undefined;
    const imCriteria = {
      propertyType: criteria.propertyType,
      includeNew: criteria.includeNew,
      surfaceMin: criteria.surfaceMin,
      surfaceMax: criteria.surfaceMax,
      priceMin: criteria.priceMin,
      priceMax: criteria.priceMax,
      quartierSlugs,
      statoIds,
      energyId,
      maxPages: 50,
    };
    fetch(immotopWebhook!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, criteria: imCriteria, source: "immotop", ingestUrl: `${opts.base}/api/ingest`, ingestSecret }),
    }).catch(async () => {
      await pool
        .query(
          `UPDATE runs SET
             sources_pending = GREATEST(COALESCE(sources_pending,1) - 1, 0),
             status = CASE WHEN GREATEST(COALESCE(sources_pending,1) - 1, 0) = 0 AND status='running' THEN 'done' ELSE status END,
             finished_at = CASE WHEN GREATEST(COALESCE(sources_pending,1) - 1, 0) = 0 AND status='running' THEN now() ELSE finished_at END
           WHERE id=$1`,
          [runId]
        )
        .catch(() => {});
    });
  }

  return { ok: true, runId };
}

/** Construit l'origine publique de l'app depuis la requête (fallback PUBLIC_APP_URL). */
export function resolveBase(req: Request): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL;
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}
