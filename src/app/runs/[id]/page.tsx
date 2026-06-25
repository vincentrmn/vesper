"use client";
import { Fragment, useEffect, useState } from "react";
import PhotoStrip from "@/components/PhotoStrip";
import { extractKeywords, extractSurfaces } from "@/lib/keywords";
import { exportPdf, exportExcel, type ExportComparable, type ExportAnalysis } from "@/lib/exportRun";
import { ExcelIcon, PdfIcon } from "@/components/ExportIcons";

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
  buildYear?: number | null;
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

const eur = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const plur = (n: number) => (n > 1 ? "s" : "");

const ETAT_LABEL: Record<string, string> = { a_renover: "À rénover", habitable: "Habitable", renove: "Rénové" };

// Libellé d'affichage du bien : nom de l'annonce si présent, sinon un libellé
// reconstruit (surface · chambres) — jamais l'id brut.
function displayTitle(r: Comparable): string {
  const t = (r.title || "").trim();
  if (t && t.toLowerCase() !== String(r.id).toLowerCase() && !/^immotop-/.test(t)) return t;
  const parts: string[] = [];
  if (typeof r.surface === "number") parts.push(`${r.surface} m²`);
  if (r.rooms) parts.push(`${r.rooms} ch.`);
  return parts.length ? parts.join(" · ") : "Annonce";
}

function EtatBadge({ etat }: { etat?: string | null }) {
  if (!etat || !ETAT_LABEL[etat]) return null;
  return <span className={`etat-badge ${etat}`}>{ETAT_LABEL[etat]}</span>;
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
  confParts?: {
    nComps: number;
    sizeLabel: string;
    spreadPct: number;
    dispLabel: string;
    hasSigned: boolean;
  };
};

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function confColor(label?: string): string {
  if (label === "Élevée") return "var(--green-ink)";
  if (label === "Bonne") return "#1f7a4d";
  if (label === "Modérée") return "#9a6b00";
  return "#a12020";
}

/** Carte « Analyse » : le chemin Affiché → décote → Signé en clair, puis
 *  distribution, moyennes, et deux encarts explicatifs (lecture + confiance). */
function Analyse({ est, comps, excludedCount }: { est: Estimate | null; comps: Comparable[]; excludedCount: number }) {
  // Replié par défaut : la carte mène avec le résultat + les indices ; la
  // méthode et le détail de la confiance s'ouvrent à la demande.
  const [showMethod, setShowMethod] = useState(false);

  const sv = comps.map((c) => c.surface).filter((v): v is number => typeof v === "number" && v > 0);
  const pv = comps.map((c) => c.price).filter((v): v is number => typeof v === "number" && v > 0);
  const mv = comps.map((c) => c.priceM2).filter((v): v is number => typeof v === "number" && v > 0);

  if (!est) {
    return (
      <div className="ds-card" style={{ marginBottom: 16 }}><div className="ds-card__body">
        <p className="ds-muted" style={{ margin: 0, fontStyle: "italic" }}>Analyse en cours…</p>
      </div></div>
    );
  }

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <h2 className="ds-h2" style={{ margin: 0, fontSize: "var(--ds-fs-md)" }}>
        Analyse {est.commune ? <span className="ds-muted" style={{ fontWeight: 400 }}>· {est.commune}</span> : null}
      </h2>
      <div className="ds-row__actions" style={{ alignItems: "center", gap: 10 }}>
        {est.enough && (
          <span className="ds-pill" style={{ color: confColor(est.confLabel), borderColor: `${confColor(est.confLabel)}55` }}>
            <span className="ds-dot" style={{ background: confColor(est.confLabel) }} /> Confiance {est.confLabel} ({est.confidence}/100)
          </span>
        )}
        <button className="ds-btn ds-btn--ghost ds-btn--sm" onClick={() => setShowMethod((v) => !v)}>
          {showMethod ? "▾ Méthode & confiance" : "▸ Méthode & confiance"}
        </button>
      </div>
    </div>
  );

  if (!est.enough) {
    return (
      <div className="card analyse" style={{ marginBottom: 16, borderLeft: "3px solid var(--line)" }}>
        {header}
        <p className="muted" style={{ margin: "10px 0 0", fontStyle: "italic", fontSize: "0.88rem" }}>
          {est.message || "Pas assez de comparables retenus pour une estimation fiable."}
        </p>
      </div>
    );
  }

  const d = est.displayed!;
  const e = est.estimate!;
  const cp = est.confParts;
  const span = d.max - d.min || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - d.min) / span) * 100));

  return (
    <div className="card analyse" style={{ marginBottom: 16, borderLeft: "3px solid var(--green)" }}>
      {header}

      {/* Le chemin du prix : Affiché → −décote → Signé estimé. */}
      <div className="flow">
        <div className="flow-box">
          <div className="flow-k">Prix affiché médian</div>
          <div className="flow-v">{eur(d.median)}<span className="flow-u">/m²</span></div>
          <div className="flow-sub">d'après les annonces</div>
        </div>
        <div className="flow-op">
          <div className="flow-op-badge">− {est.decotePct}%</div>
          <div className="flow-op-k">décote<br />affiché → signé</div>
        </div>
        <div className="flow-box flow-box-strong">
          <div className="flow-k">Estimation prix signé</div>
          <div className="flow-v flow-v-green">{eur(e.low)} <span className="flow-dash">–</span> {eur(e.high)}<span className="flow-u">/m²</span></div>
          <div className="flow-sub">médiane {eur(e.median)}/m²</div>
        </div>
      </div>

      {/* Référence Observatoire (prix réellement signés chez le notaire). */}
      <div className="analyse-obs">
        <span className="ds-muted">Référence Observatoire de l'Habitat · prix de vente signés (notariés){est.commune ? `, ${est.commune}` : ""} : </span>
        {est.signedRef ? (
          <strong>{eur(est.signedRef.signed)}/m² <span className="muted" style={{ fontWeight: 400 }}>(période {est.signedRef.period})</span></strong>
        ) : (
          <strong className="muted">non disponible pour cette commune</strong>
        )}
      </div>

      {/* Niveau 2 — Indices de marché (distribution + moyennes), toujours visibles. */}
          {/* Distribution des €/m² affichés. */}
          <div style={{ marginTop: 22 }}>
            <div className="analyse-k" style={{ marginBottom: 18 }}>
              Distribution des €/m² affichés ({mv.length} comparable{mv.length > 1 ? "s" : ""} retenu{mv.length > 1 ? "s" : ""}{excludedCount ? `, ${excludedCount} exclu${excludedCount > 1 ? "s" : ""}` : ""})
            </div>
            <div className="dist-bar">
              <div className="dist-iqr" style={{ left: `${pct(d.p25)}%`, width: `${pct(d.p75) - pct(d.p25)}%` }} />
              <div className="dist-tick" style={{ left: `${pct(d.median)}%` }} title={`Médiane ${eur(d.median)}`} />
              {[
                { v: d.min, l: "Min", mid: false },
                { v: d.p25, l: "P25", mid: true },
                { v: d.median, l: "Méd.", mid: false },
                { v: d.p75, l: "P75", mid: true },
                { v: d.max, l: "Max", mid: false },
              ].map((t, i) => (
                <div key={i} className={`dist-lab${t.mid ? " dist-lab-mid" : ""}`} style={{ left: `${pct(t.v)}%` }}>
                  <span className="dist-lab-v">{eur(t.v)}</span>
                  <span className="dist-lab-k">{t.l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Moyennes. */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 48 }}>
            {[
              { label: "Surface moyenne", v: avg(sv), suf: " m²", eur: false },
              { label: "Prix moyen", v: avg(pv), suf: "", eur: true },
              { label: "€/m² moyen", v: avg(mv), suf: "/m²", eur: true },
            ].map((c) => (
              <div key={c.label} style={{ textAlign: "center" }}>
                <div className="muted analyse-k">{c.label}</div>
                <div className="analyse-num">{c.v == null ? "·" : c.eur ? eur(c.v) + c.suf : `${Math.round(c.v * 10) / 10}${c.suf}`}</div>
              </div>
            ))}
          </div>

          {/* Niveau 3 — Méthode & confiance (repliées par défaut). */}
          {showMethod && (
            <>
          {/* Comment lire — vraies phrases. */}
          <div className="analyse-note">
            <div className="analyse-note-h">Comment lire cette estimation</div>
            <p>
              Les prix affichés sont ceux des annonces (atHome, Immotop). Ils sont presque toujours
              <strong> supérieurs au prix réellement signé</strong> chez le notaire. Pour estimer ce prix signé,
              on applique une décote de <strong>{est.decotePct}%</strong>.
            </p>
            <p>
              {est.signedRef ? (
                <>
                  Cette décote est <strong>mesurée localement</strong> sur les actes notariés
                  {est.commune ? ` de ${est.commune}` : ""} publiés par l'Observatoire de l'Habitat
                  (période {est.signedRef.period}) : elle est donc fiable pour cette commune.
                </>
              ) : (
                <>
                  Faute de prix signé de l'Observatoire pour cette commune, on applique une
                  <strong> décote globale prudente</strong> ({est.decoteReason || "valeur de repli"}).
                  La fourchette est donc <strong>plus indicative</strong> qu'ailleurs.
                </>
              )}
            </p>
            <p style={{ marginBottom: 0 }}>
              Le résultat est un <strong>faisceau d'indices, pas un prix ferme</strong>. Pour une maison en
              particulier, le prix au m² est trompeur : il dépend fortement du terrain, qui varie beaucoup
              d'un bien à l'autre : mieux vaut raisonner aussi en prix total.
            </p>
          </div>

          {/* D'où vient la confiance — vraies phrases + 3 facteurs. */}
          {cp && (
            <div className="analyse-note">
              <div className="analyse-note-h">
                D'où vient la confiance ?{" "}
                <span style={{ color: confColor(est.confLabel) }}>● {est.confLabel} ({est.confidence}/100)</span>
              </div>
              <p>La note combine trois facteurs :</p>
              <ul className="analyse-factors">
                <li>
                  <strong>Nombre de comparables</strong> : {cp.nComps} retenu{cp.nComps > 1 ? "s" : ""} ({cp.sizeLabel}).
                  Plus il y en a, plus l'estimation est robuste.
                </li>
                <li>
                  <strong>Homogénéité</strong> : les €/m² s'étalent de {eur(d.p25)} à {eur(d.p75)} (du 1ᵉʳ au 3ᵉ quartile,
                  soit +{cp.spreadPct}%), comparables {cp.dispLabel}. Plus c'est resserré, plus c'est fiable.
                </li>
                <li>
                  <strong>Donnée notariale</strong> :{" "}
                  {cp.hasSigned
                    ? "un prix signé de l'Observatoire existe pour la commune, ce qui ancre la décote."
                    : "aucun prix signé local, l'estimation est moins ancrée, d'où une note plus basse."}
                </li>
              </ul>
              <p style={{ marginBottom: 0 }} className="muted">
                La note ne dépasse jamais 95 : une estimation reste une estimation.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [expBusy, setExpBusy] = useState<"" | "pdf" | "xlsx">("");
  const [expPhotos, setExpPhotos] = useState(false);
  const [expDetails, setExpDetails] = useState(false);

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

  async function doExport(kind: "pdf" | "xlsx") {
    setExpBusy(kind);
    try {
      const comps: ExportComparable[] = included.map((r) => ({
        title: displayTitle(r),
        commune: r.commune || "",
        url: r.url,
        price: r.price,
        surface: r.surface,
        priceM2: r.priceM2,
        rooms: r.rooms,
        cpe: r.cpe,
        source: r.source,
        etat: r.etat,
        marketStatus: r.marketStatus,
        buildYear: r.buildYear,
        photos: r.photos,
        description: r.description,
      }));
      const sv = included.map((c) => c.surface).filter((v): v is number => typeof v === "number" && v > 0);
      const pv = included.map((c) => c.price).filter((v): v is number => typeof v === "number" && v > 0);
      const mv = included.map((c) => c.priceM2).filter((v): v is number => typeof v === "number" && v > 0);
      const analysis: ExportAnalysis = {
        commune: estimate?.commune ?? null,
        nComps: included.length,
        enough: !!estimate?.enough,
        displayed: estimate?.displayed,
        signedRef: estimate?.signedRef ?? null,
        decotePct: estimate?.decotePct,
        decoteSource: estimate?.decoteSource,
        estimate: estimate?.estimate,
        confidence: estimate?.confidence,
        confLabel: estimate?.confLabel,
        avgSurface: avg(sv),
        avgPrice: avg(pv),
        avgM2: avg(mv),
      };
      const base = `vesper-${(run?.config_name || "recherche")}-${params.id}`;
      if (kind === "pdf") await exportPdf(comps, analysis, base, { photos: expPhotos, details: expDetails });
      else await exportExcel(comps, analysis, base);
    } catch (e) {
      console.error("[export]", e);
      alert("Export impossible : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExpBusy("");
    }
  }

  return (
    <div className="wrap ds-scope">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">VESPER</a>
        <h1 className="page-title">{run?.config_name || "Comparables"}</h1>
        <div className="topbar-nav">
          <a className="ds-btn ds-btn--ghost" href="/">← Retour</a>
        </div>
      </div>

      {!run && <div className="ds-empty"><span className="ds-empty__hint">Chargement…</span></div>}

      {run?.status === "running" && (
        <div className="ds-card"><div className="ds-card__body" style={{ padding: 14 }}>⏳ Scraping en cours… (rafraîchissement auto)</div></div>
      )}
      {run?.status === "error" && (
        <div className="ds-error">Erreur : {run.error}</div>
      )}

      {run?.status === "done" && (
        <>
          <div className="ds-card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
            <div className="exp-head">
              <div className="exp-opts">
                <strong style={{ fontSize: "0.9rem" }}>Exporter</strong>
                <label className="exp-opt">
                  <input type="checkbox" checked={expPhotos} onChange={(e) => setExpPhotos(e.target.checked)} disabled={!!expBusy} /> Photos
                </label>
                <label className="exp-opt">
                  <input type="checkbox" checked={expDetails} onChange={(e) => setExpDetails(e.target.checked)} disabled={!!expBusy} /> Détails (description)
                </label>
              </div>
              <div className="exp-actions">
                <button className="ds-btn ds-btn--ghost exp-btn" onClick={() => doExport("xlsx")} disabled={!!expBusy}>
                  <ExcelIcon /> {expBusy === "xlsx" ? "Génération…" : "Excel"}
                </button>
                <button className="ds-btn ds-btn--ghost exp-btn" onClick={() => doExport("pdf")} disabled={!!expBusy}>
                  <PdfIcon /> {expBusy === "pdf" ? "Génération…" : "PDF"}
                </button>
              </div>
            </div>
            {expBusy && (
              <div className="exp-progress" title={`Génération du ${expBusy === "pdf" ? "PDF" : "fichier Excel"}…`}>
                <div className="exp-progress-bar" />
              </div>
            )}
          </div>
          {(() => {
            // Répartition par source (dérivée des résultats, source de vérité fiable).
            const athomeN = results.filter((r) => r.source === "athome" || r.source === "both").length;
            const immotopN = results.filter((r) => r.source === "immotop" || r.source === "both").length;
            const bothN = results.filter((r) => r.source === "both").length;
            const sold = results.filter((r) => r.marketStatus === "sold").length;
            // Détail scraping atHome (le bloc stats n'est renseigné que par le POST atHome).
            const neuf = stats?.countNew ?? 0;
            const incomplete = stats?.countIncomplete ?? 0;
            const residual = stats ? Math.max(0, stats.totalAtHome - neuf - incomplete - athomeN) : 0;
            const exclusions = [
              { label: "neufs / en construction", n: neuf },
              { label: "hors critères CPE, type ou doublons", n: residual },
              { label: "données incomplètes (prix ou surface manquant)", n: incomplete },
            ].filter((e) => e.n > 0);
            return (
              <div className="ds-card" style={{ marginBottom: 16 }}><div className="ds-card__body">
                <div style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
                  <strong>{run.count}</strong> comparable{plur(run.count)} unique{plur(run.count)} ={" "}
                  <strong>{athomeN}</strong> atHome + <strong>{immotopN}</strong> Immotop
                  {bothN > 0 ? <> − <strong>{bothN}</strong> doublon{plur(bothN)} cross-source fusionné{plur(bothN)}</> : null}
                  {sold > 0 ? <> · dont <strong>{sold}</strong> vendu{plur(sold)}/sous compromis</> : null}.
                </div>
                {stats && (
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                    atHome : {stats.totalAtHome} annonce{plur(stats.totalAtHome)} listée{plur(stats.totalAtHome)},{" "}
                    {stats.pagesFetched} page{plur(stats.pagesFetched)} lue{plur(stats.pagesFetched)}
                    {stats.pagesPlanned > stats.pagesFetched ? ` (sur ${stats.pagesPlanned} nécessaires)` : ""}.
                  </div>
                )}
                {stats?.capped && (
                  <div className="ds-error" style={{ marginTop: 8 }}>⚠️ Plafond de pages atteint (≈ 1000 biens). Affine tes filtres pour tout couvrir.</div>
                )}
                {exclusions.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--ds-ink-soft)" }}>
                      atHome : pourquoi {exclusions.reduce((s, e) => s + e.n, 0)} annonce(s) écartée(s) au scraping ?
                    </summary>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--ds-ink-soft)", lineHeight: 1.6 }}>
                      {exclusions.map((e) => (
                        <li key={e.label}><strong>{e.n}</strong> · {e.label}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div></div>
            );
          })()}

          <Analyse est={estimate} comps={included} excludedCount={excluded.size} />

          <p className="ds-muted" style={{ margin: "0 0 12px", fontSize: "var(--ds-fs-sm)" }}>
            {run.count} comparable{plur(run.count)} · lancé le {new Date(run.started_at).toLocaleString("fr-FR")} · coche/décoche un bien pour l'inclure/exclure du calcul
          </p>

          {run.count === 0 && <div className="ds-empty"><span className="ds-empty__hint">Aucun bien ne correspond aux critères.</span></div>}
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
                          <td className="cell-study" data-label="Inclure">
                            <input
                              type="checkbox"
                              checked={!isExcl}
                              onChange={() => toggleExclude(r.id)}
                              title={isExcl ? "Inclure dans le calcul" : "Exclure du calcul"}
                              style={{ cursor: "pointer", width: 16, height: 16 }}
                            />
                          </td>
                          <td className="cell-main">
                            <a className="bien-title" href={r.url} target="_blank" rel="noreferrer" style={isExcl ? { textDecoration: "line-through" } : undefined}>
                              {displayTitle(r)}
                            </a>
                            {r.commune && <div className="muted" style={{ fontSize: "0.78rem" }}>{r.commune}</div>}
                            <div className="tag-row">
                              {r.source === "both" && r.altUrl ? (
                                <a className="ds-tag ds-tag--both" href={r.altUrl} target="_blank" rel="noreferrer" title="Présent sur les deux portails">atHome + Immotop ↗</a>
                              ) : r.source === "immotop" ? (
                                <span className="ds-tag ds-tag--immotop" title="Source : immotop.lu">Immotop</span>
                              ) : (
                                <span className="ds-tag ds-tag--athome" title="Source : atHome.lu">atHome</span>
                              )}
                              {sold && <span className="ds-tag ds-tag--sold" title="Vendu / sous compromis">Vendu</span>}
                              <EtatBadge etat={r.etat} />
                              {kws.some((k) => k.label === "Neuf") && <span className="ds-tag ds-tag--neuf">Neuf</span>}
                            </div>
                          </td>
                          <td className="num" data-label="Prix">
                            {eur(r.price)}
                            {r.priceDelta != null && (
                              <span className={`ds-delta ${r.priceDelta < 0 ? "ds-delta--down" : "ds-delta--up"}`} style={{ marginLeft: 6 }}>
                                {eur(Math.abs(r.priceDelta))}
                              </span>
                            )}
                          </td>
                          <td className="num" data-label="m²">{r.surface}</td>
                          <td className="num" data-label="€/m²">{r.priceM2 != null ? eur(r.priceM2) : "·"}</td>
                          <td className="num" data-label="Ch.">{r.rooms ?? "·"}</td>
                          <td data-label="CPE"><span className="badge">{r.cpe || "·"}</span></td>
                        </tr>
                        {isOpen && (
                          <tr className="detail-row">
                            <td colSpan={8} style={{ background: "var(--paper-2)", padding: "12px 16px" }}>
                              <PhotoStrip photos={r.photos} />
                              {(() => {
                                const surf = extractSurfaces(r.description);
                                const facts: { l: string; v: string }[] = [];
                                if (r.buildYear) facts.push({ l: "Année de construction", v: String(r.buildYear) });
                                facts.push({ l: "Surface (champ)", v: `${r.surface} m²` });
                                if (surf.habitable) facts.push({ l: "Surface habitable (annonce)", v: `${surf.habitable} m²` });
                                if (surf.terrain) facts.push({ l: "Terrain (annonce)", v: `${surf.terrain} m²` });
                                if (r.rooms) facts.push({ l: "Chambres", v: String(r.rooms) });
                                return (
                                  <div className="tag-row" style={{ marginTop: 10, gap: 14 }}>
                                    {facts.map((f) => (
                                      <span key={f.l} style={{ fontSize: "0.8rem" }}>
                                        <span className="muted">{f.l} : </span>
                                        <strong className="mono">{f.v}</strong>
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}
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
                                  {r.source === "immotop"
                                    ? "Immotop ne fournit pas de description dans sa liste (réservée à la fiche, sous anti-bot)."
                                    : "Pas de description pour ce bien sur atHome."}
                                </p>
                              )}
                              <p style={{ margin: "10px 0 0" }}>
                                <a className="ds-btn ds-btn--ghost ds-btn--sm" href={r.url} target="_blank" rel="noreferrer">Voir l'annonce ↗</a>
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
