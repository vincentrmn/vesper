"use client";
import { Fragment, useEffect, useState } from "react";
import PhotoStrip from "@/components/PhotoStrip";
import { extractKeywords } from "@/lib/keywords";

type Comparable = {
  id: string;
  url: string;
  title?: string;
  price: number;
  surface: number;
  commune?: string;
  cpe?: string;
  rooms?: number;
  priceM2: number | null;
  priceDelta?: number | null;
  source?: "athome" | "immotop" | "both";
  altUrl?: string;
  etat?: "a_renover" | "habitable" | "renove" | null;
  marketStatus?: "active" | "sold";
  photos?: string[];
  description?: string | null;
};
type RunStats = {
  totalAtHome: number;
  pagesFetched: number;
  pagesPlanned: number;
  countSold: number;
  countNew: number;
  capped: boolean;
  countReceived?: number;
  countIncomplete?: number;
};
type Run = {
  id: number;
  config_name: string;
  status: string;
  count: number;
  error?: string;
  started_at: string;
  results: Comparable[];
  stats?: RunStats | null;
  excluded_ids?: string[];
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const plur = (n: number) => (n > 1 ? "s" : "");

const ETAT_LABEL: Record<string, string> = { a_renover: "À rénover", habitable: "Habitable", renove: "Rénové" };
function EtatBadge({ etat }: { etat?: string | null }) {
  if (!etat || !ETAT_LABEL[etat]) return null;
  return <span className={`etat-badge ${etat}`}>{ETAT_LABEL[etat]}</span>;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function Distribution({ comps }: { comps: Comparable[] }) {
  const vals = comps
    .map((c) => c.priceM2)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (vals.length < 3) {
    return (
      <p className="muted" style={{ fontSize: "0.85rem", fontStyle: "italic", margin: 0 }}>
        Trop peu de comparables retenus ({vals.length}) pour une distribution fiable des €/m².
      </p>
    );
  }
  const cells: { label: string; v: number | null }[] = [
    { label: "Min", v: vals[0] },
    { label: "P25", v: percentile(vals, 0.25) },
    { label: "Médiane", v: percentile(vals, 0.5) },
    { label: "P75", v: percentile(vals, 0.75) },
    { label: "Max", v: vals[vals.length - 1] },
  ];
  return (
    <div className="grid cols-2" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
      {cells.map((c) => (
        <div key={c.label} style={{ textAlign: "center" }}>
          <div className="muted" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</div>
          <div className="mono" style={{ fontSize: "1rem", fontWeight: 600 }}>{c.v != null ? eur(c.v) + "/m²" : "—"}</div>
        </div>
      ))}
    </div>
  );
}

type Estimate = {
  enough: boolean;
  nComps: number;
  commune?: string | null;
  message?: string;
  displayed?: { min: number; p25: number; median: number; p75: number; max: number };
  signedRef?: { signed: number; period: string } | null;
  decotePct?: number;
  decoteSource?: "commune" | "global";
  decoteReason?: string | null;
  estimate?: { low: number; median: number; high: number };
  confidence?: number;
  confLabel?: string;
};

function MarketReading({ est }: { est: Estimate | null }) {
  if (!est) return null;
  if (!est.enough) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Lecture marché {est.commune ? `— ${est.commune}` : ""}
        </div>
        <p className="muted" style={{ margin: 0, fontStyle: "italic", fontSize: "0.85rem" }}>{est.message}</p>
      </div>
    );
  }
  const e = est.estimate!;
  return (
    <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--green)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Lecture marché {est.commune ? `— ${est.commune}` : ""}
        </div>
        <span className={`badge`} title="Note de confiance" style={{ background: "var(--green-soft)", color: "var(--green-ink)" }}>
          Confiance {est.confLabel} ({est.confidence})
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 12, alignItems: "flex-end" }}>
        <div>
          <div className="muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Affiché médian</div>
          <div className="mono" style={{ fontSize: "1.05rem", fontWeight: 600 }}>{eur(est.displayed!.median)}/m²</div>
        </div>
        <div style={{ fontSize: "1.3rem", color: "var(--ink-soft)" }}>→</div>
        <div>
          <div className="muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>
            Estimation signée (fourchette)
          </div>
          <div className="mono" style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--green-ink)" }}>
            {eur(e.low)} – {eur(e.high)}/m² <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>(méd. {eur(e.median)})</span>
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>Décote affiché→signé</div>
          <div className="mono" style={{ fontSize: "1.05rem", fontWeight: 600 }}>−{est.decotePct} %</div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.78rem", margin: "12px 0 0", lineHeight: 1.5 }}>
        {est.signedRef ? (
          <>Réf. Observatoire (actes notariés, {est.commune}) : <strong>{eur(est.signedRef.signed)}/m²</strong> signé · période {est.signedRef.period}. Décote mesurée sur la commune.</>
        ) : (
          <>Pas de prix signé Observatoire pour cette commune : décote <strong>globale</strong> appliquée ({est.decoteReason || "fallback prudent"}). Fourchette plus indicative.</>
        )}{" "}
        Prix affichés (annonces) → la valeur signée se lit dans les actes. C'est un faisceau d'indices, pas un prix ferme.
      </p>
    </div>
  );
}

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  useEffect(() => {
    let stop = false;
    async function tick() {
      const r = await fetch(`/api/runs?id=${params.id}`).then((x) => x.json());
      if (stop) return;
      setRun(r);
      if (Array.isArray(r?.excluded_ids)) setExcluded(new Set(r.excluded_ids));
      if (r.status === "running") setTimeout(tick, 2500);
    }
    tick();
    return () => {
      stop = true;
    };
  }, [params.id]);

  // Lecture marché : (re)calculée quand le run est prêt et à chaque inclusion/exclusion.
  useEffect(() => {
    if (run?.status !== "done") return;
    const t = setTimeout(() => {
      fetch(`/api/estimate?run=${params.id}`)
        .then((r) => r.json())
        .then((e) => setEstimate(e))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [params.id, run?.status, excluded]);

  const stats = run?.stats;
  const toggleOpen = (id: string) => setOpen((p) => ({ ...p, [id]: !p[id] }));

  async function toggleExclude(id: string) {
    const isExcl = excluded.has(id);
    setExcluded((prev) => {
      const next = new Set(prev);
      isExcl ? next.delete(id) : next.add(id);
      return next;
    });
    await fetch("/api/runs/exclude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: Number(params.id), id, excluded: !isExcl }),
    }).catch(() => {});
  }

  const results = run?.results ?? [];
  const included = results.filter((r) => !excluded.has(r.id));

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">VESPER</a>
        <h1 className="page-title">{run?.config_name || "Comparables"}</h1>
        <div className="topbar-nav">
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      {!run && <p className="empty">Chargement…</p>}

      {run?.status === "running" && (
        <div className="card"><p style={{ margin: 0 }}>⏳ Scraping en cours… (rafraîchissement auto)</p></div>
      )}
      {run?.status === "error" && (
        <div className="card"><p className="error" style={{ margin: 0 }}>Erreur : {run.error}</p></div>
      )}

      {run?.status === "done" && (
        <>
          {stats && (() => {
            const sold = stats.countSold ?? 0;
            const neuf = stats.countNew ?? 0;
            const incomplete = stats.countIncomplete ?? 0;
            // Les vendus/sous compromis sont désormais inclus dans run.count.
            const residual = Math.max(0, stats.totalAtHome - neuf - incomplete - run.count);
            const exclusions = [
              { label: "neufs / en construction", n: neuf },
              { label: "hors critères CPE, type ou doublons", n: residual },
              { label: "données incomplètes (prix ou surface manquant)", n: incomplete },
            ].filter((e) => e.n > 0);
            const totalExcluded = Math.max(0, stats.totalAtHome - run.count);
            return (
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "0.9rem" }}>
                  <strong>{stats.totalAtHome}</strong> bien{plur(stats.totalAtHome)} trouvé{plur(stats.totalAtHome)} sur atHome ·{" "}
                  <strong>{stats.pagesFetched}</strong> page{plur(stats.pagesFetched)} scrapée{plur(stats.pagesFetched)}
                  {stats.pagesPlanned > stats.pagesFetched ? ` sur ${stats.pagesPlanned} prévues` : ""} ·{" "}
                  après filtres : <strong>{run.count}</strong> comparable{plur(run.count)}
                  {sold > 0 ? ` (dont ${sold} vendu${plur(sold)} / sous compromis)` : ""}.
                </div>
                {stats.capped && (
                  <div className="error" style={{ marginTop: 8 }}>⚠️ Limite atteinte (50 pages ≈ 1000 biens). Affine tes filtres.</div>
                )}
                {totalExcluded > 0 && exclusions.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                      Pourquoi {totalExcluded} bien{plur(totalExcluded)} écarté{plur(totalExcluded)} au scraping ?
                    </summary>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--ink-soft)", lineHeight: 1.6 }}>
                      {exclusions.map((e) => (
                        <li key={e.label}><strong>{e.n}</strong> — {e.label}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })()}

          <MarketReading est={estimate} />

          {results.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Distribution des €/m² — {included.length} comparable{plur(included.length)} retenu{plur(included.length)}
                {excluded.size > 0 ? ` (${excluded.size} exclu${plur(excluded.size)})` : ""}
              </div>
              <Distribution comps={included} />
              <p className="muted" style={{ fontSize: "0.78rem", margin: "12px 0 0", fontStyle: "italic" }}>
                Prix AFFICHÉS (annonces), supérieurs au prix signé. Coche/décoche un bien pour l'inclure ou l'exclure du calcul.
                Sur les maisons, le €/m² est trompeur (terrain).
              </p>
            </div>
          )}

          <p className="muted" style={{ margin: "0 0 12px" }}>
            {run.count} comparable{plur(run.count)} · lancé le {new Date(run.started_at).toLocaleString("fr-FR")}
          </p>

          {run.count === 0 && <p className="empty">Aucun bien ne correspond aux critères.</p>}
          {run.count > 0 && (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table className="prop-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th style={{ width: 44 }} title="Inclure dans le calcul">Étude</th>
                    <th>Bien</th>
                    <th className="num">Prix</th>
                    <th className="num">m²</th>
                    <th className="num">€/m²</th>
                    <th className="num">Ch.</th>
                    <th>CPE</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const isOpen = !!open[r.id];
                    const isExcl = excluded.has(r.id);
                    const sold = r.marketStatus === "sold";
                    const kws = extractKeywords(`${r.title || ""} ${r.description || ""}`);
                    return (
                      <Fragment key={r.id}>
                        <tr style={isExcl ? { opacity: 0.45 } : undefined}>
                          <td className="cell-expand" style={{ textAlign: "center" }}>
                            <button
                              className={`expand-btn ${isOpen ? "open" : ""}`}
                              aria-label={isOpen ? "Replier" : "Voir le détail"}
                              title={isOpen ? "Replier" : "Photos, description, mots-clés"}
                              onClick={() => toggleOpen(r.id)}
                            >
                              ▸
                            </button>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={!isExcl}
                              onChange={() => toggleExclude(r.id)}
                              title={isExcl ? "Inclure dans le calcul" : "Exclure du calcul"}
                              style={{ cursor: "pointer", width: 16, height: 16 }}
                            />
                          </td>
                          <td className="cell-main">
                            <a href={r.url} target="_blank" rel="noreferrer" style={isExcl ? { textDecoration: "line-through" } : undefined}>
                              {r.title || r.id}
                            </a>
                            {sold && <span className="src-badge" style={{ background: "#fde2e2", color: "#a12020" }} title="Vendu / sous compromis">Vendu</span>}
                            {r.source === "both" && r.altUrl ? (
                              <a className="src-badge" href={r.altUrl} target="_blank" rel="noreferrer" title="Présent sur les deux portails">atHome + Immotop ↗</a>
                            ) : r.source === "immotop" ? (
                              <span className="src-badge" title="Source : immotop.lu">Immotop</span>
                            ) : null}
                            <EtatBadge etat={r.etat} />
                            {r.commune && <div className="muted" style={{ fontSize: "0.78rem" }}>{r.commune}</div>}
                          </td>
                          <td className="num" data-label="Prix">
                            {eur(r.price)}
                            {r.priceDelta != null && (
                              <span className={`delta-badge ${r.priceDelta < 0 ? "down" : "up"}`}>
                                {r.priceDelta < 0 ? "↓" : "↑"} {eur(Math.abs(r.priceDelta))}
                              </span>
                            )}
                          </td>
                          <td className="num" data-label="m²">{r.surface}</td>
                          <td className="num" data-label="€/m²">{r.priceM2 != null ? eur(r.priceM2) : "—"}</td>
                          <td className="num" data-label="Ch.">{r.rooms ?? "—"}</td>
                          <td data-label="CPE"><span className="badge">{r.cpe || "—"}</span></td>
                        </tr>
                        {isOpen && (
                          <tr className="detail-row">
                            <td colSpan={8} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                              <PhotoStrip photos={r.photos} />
                              {kws.length > 0 && (
                                <div className="chips" style={{ marginTop: 10, marginBottom: 4 }}>
                                  {kws.map((k) => (
                                    <span key={k.label} className={`chip on kw-${k.kind}`} style={{ cursor: "default" }}>{k.label}</span>
                                  ))}
                                </div>
                              )}
                              {r.description ? (
                                <p style={{ margin: "10px 0 0", fontSize: "0.85rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                                  {r.description}
                                </p>
                              ) : (
                                <p className="muted" style={{ fontSize: "0.82rem", fontStyle: "italic", margin: "10px 0 0" }}>
                                  Pas de description scrapée pour ce bien.
                                </p>
                              )}
                              <p style={{ margin: "10px 0 0" }}>
                                <a className="btn ghost" href={r.url} target="_blank" rel="noreferrer">Voir l'annonce ↗</a>
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
