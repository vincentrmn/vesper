"use client";
// Styleguide « BBI tools » (dense pro) — vitrine des primitives du design system.
// Page de validation : on règle les tokens ici avant de migrer les vraies pages.
import { useState } from "react";

export default function StyleGuide() {
  const [chips, setChips] = useState<Record<string, boolean>>({ reno: true, hab: false });
  const [tab, setTab] = useState("comparables");
  const [modal, setModal] = useState(false);
  const swatches: [string, string][] = [
    ["--ds-ink", "Ink"], ["--ds-ink-soft", "Ink soft"], ["--ds-line", "Line"],
    ["--ds-bg-subtle", "Subtle"], ["--ds-accent", "Accent"], ["--ds-accent-ink", "Accent ink"],
  ];
  return (
    <div className="ds-scope" style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 22px 80px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="ds-h1">BBI tools</span>
        <span className="ds-muted ds-label">design system · dense pro</span>
      </div>
      <p className="ds-muted" style={{ marginTop: 6, fontSize: "var(--ds-fs-sm)" }}>
        Base de primitives en CSS maison. Page de réglage avant migration des écrans Vesper.
      </p>

      {/* Couleurs */}
      <div className="ds-section"><span className="ds-h2">Couleurs</span><span className="ds-rule" /></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {swatches.map(([v, n]) => (
          <div key={v} style={{ width: 120 }}>
            <div style={{ height: 52, borderRadius: 8, border: "1px solid var(--ds-line)", background: `var(${v})` }} />
            <div className="ds-label" style={{ marginTop: 6 }}>{n}</div>
          </div>
        ))}
      </div>

      {/* Boutons */}
      <div className="ds-section"><span className="ds-h2">Boutons</span><span className="ds-rule" /></div>
      <div className="ds-toolbar">
        <button className="ds-btn ds-btn--primary">Enregistrer & lancer</button>
        <button className="ds-btn ds-btn--secondary">Relancer</button>
        <button className="ds-btn ds-btn--ghost">Voir</button>
        <button className="ds-btn ds-btn--danger">Supprimer</button>
        <span className="ds-toolbar__sep" />
        <button className="ds-btn ds-btn--ghost ds-btn--sm">Petit</button>
        <button className="ds-btn ds-btn--primary" disabled>Désactivé</button>
      </div>

      {/* Champs */}
      <div className="ds-section"><span className="ds-h2">Champs</span><span className="ds-rule" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <div className="ds-field"><span className="ds-label">Surface min (m²)</span><input className="ds-input" placeholder="ex : 60" /></div>
        <div className="ds-field"><span className="ds-label">Prix max (€)</span><input className="ds-input" placeholder="ex : 800000" /></div>
        <div className="ds-field"><span className="ds-label">Type de bien</span>
          <select className="ds-select"><option>Appartement</option><option>Maison</option><option>Les deux</option></select>
        </div>
      </div>

      {/* Chips & tags */}
      <div className="ds-section"><span className="ds-h2">Chips & tags</span><span className="ds-rule" /></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {([["reno", "Rénové"], ["hab", "Habitable"], ["aren", "À rénover"]] as const).map(([k, l]) => (
          <span key={k} className="ds-chip" data-on={!!chips[k]} onClick={() => setChips((p) => ({ ...p, [k]: !p[k] }))}>{l}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="ds-tag ds-tag--athome">atHome</span>
        <span className="ds-tag ds-tag--immotop">Immotop</span>
        <span className="ds-tag ds-tag--both">atHome + Immotop</span>
        <span className="ds-tag ds-tag--neuf">Neuf</span>
        <span className="ds-tag ds-tag--reno">Rénové</span>
        <span className="ds-tag ds-tag--sold">Vendu</span>
        <span className="ds-pill"><span className="ds-dot" /> Confiance Bonne (62/100)</span>
      </div>

      {/* KPI */}
      <div className="ds-section"><span className="ds-h2">Indicateurs</span><span className="ds-rule" /></div>
      <div className="ds-stats">
        <div className="ds-stat"><div className="ds-stat__k">Comparables</div><div className="ds-stat__v">111</div></div>
        <div className="ds-stat"><div className="ds-stat__k">€/m² médian affiché</div><div className="ds-stat__v ds-num">8 240 €</div></div>
        <div className="ds-stat"><div className="ds-stat__k">Estimation signée</div><div className="ds-stat__v ds-stat__v--accent ds-num">7 650 €</div></div>
        <div className="ds-stat"><div className="ds-stat__k">Surface moyenne</div><div className="ds-stat__v ds-num">78 m²</div></div>
      </div>

      {/* Carte + table dense */}
      <div className="ds-section"><span className="ds-h2">Carte & tableau</span><span className="ds-rule" /></div>
      <div className="ds-card ds-card--accent">
        <div className="ds-card__head">
          <span className="ds-h2" style={{ fontSize: "var(--ds-fs-md)" }}>Comparables · Frisange</span>
          <span className="ds-pill"><span className="ds-dot" /> 111 biens</span>
        </div>
        <div className="ds-card__body" style={{ padding: 0 }}>
          <div className="ds-table__wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="ds-table">
              <thead><tr><th>Bien</th><th>Source</th><th className="ds-num">Prix</th><th className="ds-num">m²</th><th className="ds-num">€/m²</th><th>État</th></tr></thead>
              <tbody>
                {[
                  ["Appartement 2 ch., Aspelt", "immotop", "653 200 €", "54", "12 096 €", "reno"],
                  ["Penthouse neuf, Frisange", "athome", "845 000 €", "120", "7 042 €", "neuf"],
                  ["Appartement 3 ch., Hellange", "both", "590 000 €", "92", "6 413 €", "reno"],
                ].map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{r[0]}</td>
                    <td><span className={`ds-tag ds-tag--${r[1]}`}>{r[1] === "both" ? "atHome+Immotop" : r[1] === "athome" ? "atHome" : "Immotop"}</span></td>
                    <td className="ds-num">{r[2]}</td>
                    <td className="ds-num">{r[3]}</td>
                    <td className="ds-num">{r[4]}</td>
                    <td><span className={`ds-tag ds-tag--${r[5]}`}>{r[5] === "neuf" ? "Neuf" : "Rénové"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Delta prix + distribution */}
      <div className="ds-section"><span className="ds-h2">Écart prix & distribution</span><span className="ds-rule" /></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <span className="ds-delta ds-delta--up">+18 % vs signé</span>
        <span className="ds-delta ds-delta--down">−7 % vs réf</span>
        <span className="ds-delta ds-delta--flat">aligné</span>
        <span className="ds-tip" data-tip="Réf. Observatoire (prix signé) : 7 650 €/m²" tabIndex={0}>
          <span className="ds-pill"><span className="ds-dot ds-dot--warn" /> survol = info</span>
        </span>
      </div>
      <div className="ds-card">
        <div className="ds-card__body">
          <div className="ds-label" style={{ marginBottom: 4 }}>€/m² affichés · distribution (n=111)</div>
          <div className="ds-dist">
            <div className="ds-dist__bar">
              <div className="ds-dist__iqr" style={{ left: "30%", right: "28%" }} />
              {([["6 010 €", "min", 4], ["7 200 €", "p25", 30], ["8 240 €", "médiane", 52], ["9 100 €", "p75", 72], ["12 100 €", "max", 96]] as const).map(([v, k, x]) => (
                <span key={k}>
                  <span className="ds-dist__tick" style={{ left: `${x}%` }} />
                  <span className="ds-dist__lab" style={{ left: `${x}%` }}><span className="ds-dist__v ds-num">{v}</span><span className="ds-dist__k">{k}</span></span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="ds-section"><span className="ds-h2">Onglets</span><span className="ds-rule" /></div>
      <div className="ds-tabs" role="tablist">
        {([["comparables", "Comparables"], ["marche", "Lecture marché"], ["sources", "Sources"]] as const).map(([k, l]) => (
          <button key={k} className="ds-tab" data-on={tab === k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <p className="ds-muted" style={{ marginTop: 8, fontSize: "var(--ds-fs-sm)" }}>Onglet actif : <strong>{tab}</strong></p>

      {/* États : vide + chargement */}
      <div className="ds-section"><span className="ds-h2">États vide & chargement</span><span className="ds-rule" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
        <div className="ds-empty">
          <span className="ds-empty__title">Pas assez de comparables</span>
          <span className="ds-empty__hint">Moins de 5 biens homogènes sur cette commune. L'estimation serait indicative : élargis la surface ou le rayon.</span>
          <button className="ds-btn ds-btn--ghost ds-btn--sm" style={{ marginTop: 4 }}>Élargir la recherche</button>
        </div>
        <div className="ds-card"><div className="ds-card__body" style={{ display: "grid", gap: 10 }}>
          <div className="ds-skeleton ds-skeleton--line" style={{ width: "55%" }} />
          <div className="ds-skeleton ds-skeleton--line" style={{ width: "85%" }} />
          <div className="ds-skeleton ds-skeleton--block" />
        </div></div>
      </div>

      {/* Photo strip */}
      <div className="ds-section"><span className="ds-h2">Bande photos</span><span className="ds-rule" /></div>
      <div className="ds-photos">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="ds-photo" style={{ background: `linear-gradient(135deg, var(--ds-bg-sunken), var(--ds-accent-soft) ${i * 18}%)` }} title="Agrandir la photo" />
        ))}
      </div>

      {/* Modal */}
      <div className="ds-section"><span className="ds-h2">Modale</span><span className="ds-rule" /></div>
      <button className="ds-btn ds-btn--secondary" onClick={() => setModal(true)}>Ouvrir la modale</button>
      {modal && (
        <div className="ds-overlay" role="dialog" aria-modal="true" onClick={() => setModal(false)}>
          <div className="ds-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal__head">
              <span className="ds-h2" style={{ fontSize: "var(--ds-fs-md)" }}>Exclure ce comparable ?</span>
              <button className="ds-modal__x" aria-label="Fermer" onClick={() => setModal(false)}>×</button>
            </div>
            <div className="ds-modal__body">Le bien « Penthouse neuf, Frisange » (7 042 €/m²) sera retiré du calcul de la distribution et de la fourchette. Réversible à tout moment.</div>
            <div className="ds-modal__foot">
              <button className="ds-btn ds-btn--ghost" onClick={() => setModal(false)}>Annuler</button>
              <button className="ds-btn ds-btn--primary" onClick={() => setModal(false)}>Exclure</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
