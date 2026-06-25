"use client";
import { useEffect, useState } from "react";

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
};

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const plur = (n: number) => (n > 1 ? "s" : "");

const ETAT_LABEL: Record<string, string> = { a_renover: "À rénover", habitable: "Habitable", renove: "Rénové" };
function EtatBadge({ etat }: { etat?: string | null }) {
  if (!etat || !ETAT_LABEL[etat]) return null;
  return <span className={`etat-badge ${etat}`}>{ETAT_LABEL[etat]}</span>;
}

// Percentile (interpolation linéaire) sur un tableau trié croissant.
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
      <p className="muted" style={{ fontSize: "0.85rem", fontStyle: "italic" }}>
        Trop peu de comparables ({vals.length}) pour une distribution fiable des €/m².
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
          <div className="mono" style={{ fontSize: "1rem", fontWeight: 600 }}>
            {c.v != null ? eur(c.v) + "/m²" : "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    let stop = false;
    async function tick() {
      const r = await fetch(`/api/runs?id=${params.id}`).then((x) => x.json());
      if (stop) return;
      setRun(r);
      if (r.status === "running") setTimeout(tick, 2500);
    }
    tick();
    return () => {
      stop = true;
    };
  }, [params.id]);

  const stats = run?.stats;

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
            const residual = Math.max(0, stats.totalAtHome - sold - neuf - incomplete - run.count);
            const exclusions = [
              { label: "vendus (déjà sous compromis)", n: sold },
              { label: "neufs / en construction", n: neuf },
              { label: "hors critères CPE, type ou doublons", n: residual },
              { label: "données incomplètes (prix ou surface manquant)", n: incomplete },
            ].filter((e) => e.n > 0);
            const totalExcluded = stats.totalAtHome - run.count;
            return (
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "0.9rem" }}>
                  <strong>{stats.totalAtHome}</strong> bien{plur(stats.totalAtHome)} trouvé{plur(stats.totalAtHome)} sur atHome ·{" "}
                  <strong>{stats.pagesFetched}</strong> page{plur(stats.pagesFetched)} scrapée{plur(stats.pagesFetched)}
                  {stats.pagesPlanned > stats.pagesFetched ? ` sur ${stats.pagesPlanned} prévues` : ""} ·{" "}
                  après filtres : <strong>{run.count}</strong> comparable{plur(run.count)}.
                </div>
                {stats.capped && (
                  <div className="error" style={{ marginTop: 8 }}>
                    ⚠️ Limite atteinte (50 pages ≈ 1000 biens). Affine tes filtres.
                  </div>
                )}
                {totalExcluded > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                      Pourquoi {totalExcluded} bien{plur(totalExcluded)} exclu{plur(totalExcluded)} ?
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

          {run.count > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Distribution des €/m² ({run.count} comparable{plur(run.count)})
              </div>
              <Distribution comps={run.results} />
              <p className="muted" style={{ fontSize: "0.78rem", margin: "12px 0 0", fontStyle: "italic" }}>
                Prix AFFICHÉS (annonces), supérieurs au prix signé. La décote affiché→signé (Observatoire) et la
                fourchette d'estimation sont la prochaine couche (Phase 2). Sur les maisons, le €/m² est trompeur (terrain).
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
                    <th>Bien</th>
                    <th className="num">Prix</th>
                    <th className="num">m²</th>
                    <th className="num">€/m²</th>
                    <th className="num">Ch.</th>
                    <th>CPE</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-main">
                        <a href={r.url} target="_blank" rel="noreferrer">{r.title || r.id}</a>
                        {r.source === "both" && r.altUrl ? (
                          <a className="src-badge" href={r.altUrl} target="_blank" rel="noreferrer" title="Présent sur les deux portails">atHome + Immotop ↗</a>
                        ) : r.source === "immotop" ? (
                          <span className="src-badge" title="Source : immotop.lu">Immotop</span>
                        ) : null}
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
                      <td data-label="État"><EtatBadge etat={r.etat} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
