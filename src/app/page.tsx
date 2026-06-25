"use client";
import { useEffect, useState } from "react";
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
  return "—";
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

export default function Dashboard() {
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [showRuns, setShowRuns] = useState(true);
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
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">VESPER</a>
        <span className="page-title" />
        <div className="topbar-nav" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="section-title" style={{ flex: 1, margin: 0 }}>
          <h2>Recherches sauvegardées</h2>
          <span className="rule" />
        </div>
        <button className="btn clay" onClick={() => router.push("/search/new")}>
          + Nouvelle estimation
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {configs.length === 0 && <p className="empty">Aucune recherche. Crée ta première estimation.</p>}
        {configs.map((c) => {
          const cr = c.criteria || {};
          return (
            <div className="list-item" key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
                  {typeLabel(cr.propertyType)} · {summarizeZones(cr)} · CPE {summarizeCpe(cr)} ·{" "}
                  {summarizeSources(cr)}
                  {cr.includeNew ? " · neuf inclus" : ""}
                </div>
              </div>
              <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
                <button className="btn" onClick={() => relancer(c.id)} disabled={busy === c.id}>
                  {busy === c.id ? "..." : "Relancer"}
                </button>
                <button className="btn ghost" onClick={() => supprimer(c.id)}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="section-title"
        onClick={() => setShowRuns((v) => !v)}
        style={{ cursor: "pointer", userSelect: "none" }}
        title={showRuns ? "Replier" : "Déplier"}
      >
        <h2>
          <span style={{ display: "inline-block", transform: showRuns ? "rotate(90deg)" : "none", transition: "transform 0.12s ease", marginRight: 8 }}>
            ▸
          </span>
          Dernières estimations{runs.length > 0 ? ` (${runs.length})` : ""}
        </h2>
        <span className="rule" />
      </div>
      {showRuns && runs.length === 0 && <p className="empty">Aucune estimation lancée pour l'instant.</p>}
      {showRuns &&
        runs.map((r) => (
          <a className="list-item" key={r.id} href={`/runs/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div>
              <strong>{r.config_name || "—"}</strong>
              <div className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>
                {new Date(r.started_at).toLocaleString("fr-FR")}
              </div>
            </div>
            <div className="row" style={{ flex: "0 0 auto", alignItems: "center" }}>
              <span className="badge">{r.status}</span>
              <span className="mono">{r.count} comps</span>
              <button
                className="btn ghost"
                title="Supprimer cette estimation"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  supprimerRun(r.id);
                }}
              >
                ✕
              </button>
            </div>
          </a>
        ))}
    </div>
  );
}
