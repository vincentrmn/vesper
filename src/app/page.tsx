"use client";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Cfg = {
  id: number;
  name: string;
  criteria: any;
  updated_at: string;
};
type Run = {
  id: number;
  config_name: string;
  status: string;
  count: number;
  started_at: string;
};

function summarizeZones(criteria: any): string {
  if (Array.isArray(criteria?.locCodes) && criteria.locCodes.length) {
    if (criteria.locCodes.includes("L9-luxembourg")) return "Tout Luxembourg-Ville";
    const n = criteria.locCodes.length;
    return `${n} zone${n > 1 ? "s" : ""}`;
  }
  return "·";
}

function summarizeSources(criteria: any): string {
  const s = Array.isArray(criteria?.sources) && criteria.sources.length ? criteria.sources : ["athome"];
  return s.map((x: string) => (x === "immotop" ? "Immotop" : "atHome")).join(" + ");
}

function summarizeCpe(criteria: any): string {
  const c = criteria?.cpeClasses;
  return Array.isArray(c) && c.length ? c.join("") : "toutes";
}

function typeLabel(t: any): string {
  if (t === "house") return "Maison";
  if (t === "both") return "Appartement + maison";
  return "Appartement";
}

function neufLabel(cr: any): string {
  if (cr?.newOnly) return "Neuf uniquement";
  if (cr?.includeNew) return "Existant + neuf";
  return "Existant uniquement";
}

const eur0 = (v: any) =>
  typeof v === "number" ? Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €" : "·";

function prettyLoc(code: string): string {
  const s = code.replace(/^L\d+-/, "").replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function listZones(cr: any): string {
  const lc = Array.isArray(cr?.locCodes) ? cr.locCodes : [];
  if (!lc.length) return "·";
  return lc.map(prettyLoc).join(", ");
}

function HypRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ds-kv">
      <span className="ds-kv__k">{label}</span>
      <span className="ds-kv__v">{value}</span>
    </div>
  );
}

export default function Dashboard() {
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [showRuns, setShowRuns] = useState(true);
  const [openCfg, setOpenCfg] = useState<Record<number, boolean>>({});
  const router = useRouter();

  async function load() {
    const [c, r] = await Promise.all([
      fetch("/api/configs").then((x) => x.json()),
      fetch("/api/runs").then((x) => x.json()),
    ]);
    setConfigs(Array.isArray(c) ? c : []);
    setRuns(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
  }, []);

  async function relancer(id: number) {
    setBusy(id);
    const res = await fetch("/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configId: id }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.runId) router.push(`/runs/${data.runId}`);
  }

  async function supprimer(id: number) {
    if (!confirm("Supprimer cette recherche ?")) return;
    await fetch(`/api/configs/${id}`, { method: "DELETE" });
    load();
  }

  async function supprimerRun(id: number) {
    if (!confirm("Supprimer cette estimation de l'historique ?")) return;
    setRuns((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/runs?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="wrap ds-scope ds-scope--lg">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">VESPER</a>
        <span className="page-title" />
        <div className="topbar-nav" />
      </div>

      <div className="ds-section" style={{ marginTop: 0 }}>
        <span className="ds-h2">Recherches sauvegardées</span>
        <span className="ds-rule" />
        <button className="ds-btn ds-btn--primary" onClick={() => router.push("/search/new")}>
          + Nouvelle estimation
        </button>
      </div>

      <div>
        {configs.length === 0 && (
          <div className="ds-empty">
            <span className="ds-empty__title">Aucune recherche</span>
            <span className="ds-empty__hint">Crée ta première estimation pour scraper les comparables et lire le marché.</span>
            <button className="ds-btn ds-btn--ghost ds-btn--sm" style={{ marginTop: 4 }} onClick={() => router.push("/search/new")}>+ Nouvelle estimation</button>
          </div>
        )}
        {configs.map((c) => {
          const cr = c.criteria || {};
          const isOpen = !!openCfg[c.id];
          return (
            <Fragment key={c.id}>
              <div className={`ds-row${isOpen ? " ds-row--open" : ""}`}>
                <div className="ds-row__main">
                  <div className="ds-row__title">{c.name}</div>
                  <div className="ds-row__sub">
                    {typeLabel(cr.propertyType)} · {summarizeZones(cr)} · CPE {summarizeCpe(cr)} · {summarizeSources(cr)}
                  </div>
                </div>
                <div className="ds-row__actions">
                  <button className="ds-btn ds-btn--ghost ds-btn--sm" onClick={() => setOpenCfg((p) => ({ ...p, [c.id]: !p[c.id] }))}>
                    {isOpen ? "Masquer" : "Voir"}
                  </button>
                  <button className="ds-btn ds-btn--primary ds-btn--sm" onClick={() => relancer(c.id)} disabled={busy === c.id}>
                    {busy === c.id ? "…" : "Relancer"}
                  </button>
                  <button className="ds-btn ds-btn--danger ds-btn--sm" title="Supprimer" onClick={() => supprimer(c.id)}>✕</button>
                </div>
              </div>
              {isOpen && (
                <div className="ds-drawer">
                  <div className="ds-label" style={{ marginBottom: 6 }}>Critères de recherche</div>
                  <HypRow label="Type de bien" value={typeLabel(cr.propertyType)} />
                  <HypRow label="Zones" value={listZones(cr)} />
                  <HypRow label="Surface" value={`${cr.surfaceMin ?? "·"} → ${cr.surfaceMax ?? "·"} m²`} />
                  <HypRow label="Prix" value={`${cr.priceMin != null ? eur0(cr.priceMin) : "·"} → ${cr.priceMax != null ? eur0(cr.priceMax) : "·"}`} />
                  <HypRow label="Chambres min" value={cr.bedroomsMin != null ? String(cr.bedroomsMin) : "·"} />
                  <HypRow label="Année de construction" value={`${cr.buildYearMin ?? "·"} → ${cr.buildYearMax ?? "·"}`} />
                  <HypRow label="CPE" value={summarizeCpe(cr)} />
                  <HypRow label="Construction" value={neufLabel(cr)} />
                  <HypRow label="Sources" value={summarizeSources(cr)} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <div
        className="ds-section"
        onClick={() => setShowRuns((v) => !v)}
        style={{ cursor: "pointer", userSelect: "none" }}
        title={showRuns ? "Replier" : "Déplier"}
      >
        <span className="ds-h2">
          <span style={{ display: "inline-block", transform: showRuns ? "rotate(90deg)" : "none", transition: "transform 0.12s ease", marginRight: 8 }}>▸</span>
          Dernières estimations{runs.length > 0 ? ` (${runs.length})` : ""}
        </span>
        <span className="ds-rule" />
      </div>
      {showRuns && runs.length === 0 && (
        <div className="ds-empty"><span className="ds-empty__hint">Aucune estimation lancée pour l'instant.</span></div>
      )}
      {showRuns &&
        runs.map((r) => (
          <a className="ds-row" key={r.id} href={`/runs/${r.id}`}>
            <div className="ds-row__main">
              <div className="ds-row__title">{r.config_name || "Sans nom"}</div>
              <div className="ds-row__sub">{new Date(r.started_at).toLocaleString("fr-FR")}</div>
            </div>
            <div className="ds-row__actions">
              <span className="ds-pill">{r.status}</span>
              <span className="ds-num ds-muted" style={{ fontSize: "var(--ds-fs-sm)" }}>{r.count} comps</span>
              <button
                className="ds-btn ds-btn--danger ds-btn--sm"
                title="Supprimer cette estimation"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  supprimerRun(r.id);
                }}
              >✕</button>
            </div>
          </a>
        ))}
    </div>
  );
}
