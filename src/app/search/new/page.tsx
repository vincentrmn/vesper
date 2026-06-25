"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ZonePicker from "./ZonePicker";

const CPE = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

/** Interrupteur réutilisable, basé sur le markup .toggle-switch de globals.css. */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-switch__slider" />
    </label>
  );
}

export default function NewSearch() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState("apartment");
  // Construction : existant uniquement (défaut) | neuf uniquement | les deux.
  const [construction, setConstruction] = useState<"existant" | "neuf" | "both">("existant");
  const [locCodes, setLocCodes] = useState<string[]>(["L9-luxembourg"]);
  const [surfaceMin, setSurfaceMin] = useState("");
  const [surfaceMax, setSurfaceMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [bedroomsMin, setBedroomsMin] = useState("");
  const [buildYearMin, setBuildYearMin] = useState("");
  const [buildYearMax, setBuildYearMax] = useState("");
  const [allCpe, setAllCpe] = useState(true);
  const [cpe, setCpe] = useState<string[]>([...CPE]);
  const [includeNoCpe, setIncludeNoCpe] = useState(false);
  const [sources, setSources] = useState<("athome" | "immotop")[]>(["athome", "immotop"]);
  const [conditions, setConditions] = useState<("a_renover" | "habitable" | "renove")[]>([]);
  // Bande énergie Immotop (filtre serveur classeEnergetica). "" = toutes.
  const [immotopEnergy, setImmotopEnergy] = useState<"" | "excellente" | "moyenne" | "basse">("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const hasAthome = sources.includes("athome");
  const hasImmotop = sources.includes("immotop");

  function toggleCpe(c: string) {
    setCpe((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }
  function toggleSource(s: "athome" | "immotop") {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function toggleCondition(c: "a_renover" | "habitable" | "renove") {
    setConditions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function buildPayload() {
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
    return {
      name: name.trim() || "Recherche sans nom",
      criteria: {
        propertyType,
        locCodes,
        includeNew: construction !== "existant",
        newOnly: construction === "neuf",
        surfaceMin: num(surfaceMin),
        surfaceMax: num(surfaceMax),
        priceMin: num(priceMin),
        priceMax: num(priceMax),
        bedroomsMin: num(bedroomsMin),
        buildYearMin: num(buildYearMin),
        buildYearMax: num(buildYearMax),
        cpeClasses: allCpe ? [] : cpe,
        includeNoCpe: allCpe ? false : includeNoCpe,
        sources,
        conditions: hasImmotop ? conditions : [],
        immotopEnergy: hasImmotop && immotopEnergy ? immotopEnergy : null,
      },
    };
  }

  async function save(thenRun: boolean) {
    if (sources.length === 0) {
      setErr("Commence par choisir au moins une source (atHome et/ou Immotop).");
      return;
    }
    if (locCodes.length === 0) {
      setErr("Sélectionne au moins une zone (toggle « Tout » ou un ou plusieurs quartiers).");
      return;
    }
    if (hasAthome && !allCpe && cpe.length === 0) {
      setErr("Sélectionne au moins une note CPE, ou réactive « Toutes les notes CPE ».");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    const data = await res.json();
    if (!res.ok) {
      setBusy(false);
      setErr(data.error || "Erreur");
      return;
    }
    if (!thenRun) {
      router.push("/");
      return;
    }
    const trig = await fetch("/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configId: data.id }),
    });
    const t = await trig.json();
    setBusy(false);
    if (t.runId) router.push(`/runs/${t.runId}`);
    else router.push("/");
  }

  return (
    <div className="wrap ds-scope">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">VESPER</a>
        <h1 className="page-title">Nouvelle estimation</h1>
        <div className="topbar-nav">
          <a className="ds-btn ds-btn--ghost" href="/">← Retour</a>
        </div>
      </div>

      <div className="ds-section"><span className="ds-h2">La recherche</span><span className="ds-rule" /></div>
      <div className="ds-card"><div className="ds-card__body">
        <div className="ds-field">
          <span className="ds-label">Nom de la recherche</span>
          <input className="ds-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex : Appartements ~80m² Limpertsberg" />
        </div>

        <div style={{ marginTop: 18 }}>
          <span className="ds-label" style={{ display: "block", marginBottom: 6 }}>Sources</span>
          <div className="ds-chips">
            <span className="ds-chip" data-on={hasAthome} onClick={() => toggleSource("athome")}>atHome</span>
            <span className="ds-chip" data-on={hasImmotop} onClick={() => toggleSource("immotop")}>Immotop</span>
          </div>
          <p className="ds-hint">
            {hasAthome && hasImmotop
              ? "Les biens présents sur les deux portails sont dédupliqués automatiquement (signalés « atHome + Immotop » dans les comparables)."
              : "Choisis atHome, Immotop, ou les deux. Chaque portail a ses propres filtres ci-dessous."}
          </p>
        </div>
      </div></div>

      {sources.length === 0 && (
        <div className="ds-empty" style={{ marginTop: 16 }}><span className="ds-empty__hint">Choisis au moins une source pour configurer la recherche.</span></div>
      )}

      {sources.length > 0 && (
        <>
          <div className="ds-section"><span className="ds-h2">Le bien &amp; les critères</span><span className="ds-rule" /></div>
          <div className="ds-card" style={{ marginTop: 16 }}><div className="ds-card__body">
            <div className="ds-grid">
              <div className="ds-field">
                <span className="ds-label">Type de bien</span>
                <select className="ds-select" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                  <option value="apartment">Appartement</option>
                  <option value="house">Maison</option>
                  <option value="both">Les deux</option>
                </select>
              </div>
              <div className="ds-field">
                <span className="ds-label">Construction</span>
                <select className="ds-select" value={construction} onChange={(e) => setConstruction(e.target.value as any)}>
                  <option value="existant">Existant uniquement</option>
                  <option value="neuf">Neuf uniquement</option>
                  <option value="both">Existant + neuf</option>
                </select>
              </div>
            </div>
            {construction === "neuf" && hasImmotop && (
              <p className="ds-hint">
                ⚠️ « Neuf uniquement » n'est pris en charge que par atHome. Immotop ne sait pas
                filtrer le neuf de façon fiable → il sera ignoré pour cette recherche (sinon il
                ramènerait des biens existants et fausserait l'estimation).
              </p>
            )}

            <div style={{ marginTop: 18 }}>
              <span className="ds-label" style={{ display: "block", marginBottom: 6 }}>Localisation</span>
              <ZonePicker value={locCodes} onChange={setLocCodes} />
            </div>

            <div className="ds-grid" style={{ marginTop: 16 }}>
              <div className="ds-field"><span className="ds-label">Surface min (m²)</span><input className="ds-input" type="number" value={surfaceMin} onChange={(e) => setSurfaceMin(e.target.value)} /></div>
              <div className="ds-field"><span className="ds-label">Surface max (m²)</span><input className="ds-input" type="number" value={surfaceMax} onChange={(e) => setSurfaceMax(e.target.value)} /></div>
              <div className="ds-field"><span className="ds-label">Prix min (€)</span><input className="ds-input" type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} /></div>
              <div className="ds-field"><span className="ds-label">Prix max (€)</span><input className="ds-input" type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} /></div>
            </div>

            <div className="ds-grid" style={{ marginTop: 16 }}>
              <div className="ds-field"><span className="ds-label">Chambres min</span><input className="ds-input" type="number" value={bedroomsMin} onChange={(e) => setBedroomsMin(e.target.value)} placeholder="ex : 2" /></div>
              <div className="ds-field"><span className="ds-label">Année constr. min</span><input className="ds-input" type="number" value={buildYearMin} onChange={(e) => setBuildYearMin(e.target.value)} placeholder="ex : 1990" /></div>
              <div className="ds-field"><span className="ds-label">Année constr. max</span><input className="ds-input" type="number" value={buildYearMax} onChange={(e) => setBuildYearMax(e.target.value)} /></div>
            </div>
            <p className="ds-hint">
              Année de construction : filtrée sur atHome quand l'annonce la renseigne (Immotop ne la fournit pas en liste).
            </p>
          </div></div>

          {/* ── Énergie (atHome + Immotop) ─────────────────────────────────── */}
          <div className="ds-section"><span className="ds-h2">Énergie</span><span className="ds-rule" /></div>
          <div className="ds-card"><div className="ds-card__body">
            {hasAthome && (
              <div style={{ marginBottom: hasImmotop ? 20 : 0, paddingBottom: hasImmotop ? 18 : 0, borderBottom: hasImmotop ? "1px solid var(--ds-line)" : "none" }}>
                <span className="ds-label" style={{ display: "block", marginBottom: 8 }}>Classe CPE · atHome <span className="ds-muted" style={{ fontWeight: 400 }}>(A → I, note exacte par bien)</span></span>
                <div className="zone-picker__toggle-row" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
                  <Toggle checked={!allCpe} onChange={(v) => setAllCpe(!v)} />
                  <span className="zone-picker__toggle-label">Filtrer par note CPE</span>
                </div>
                {allCpe ? (
                  <p className="ds-hint">Désactivé : toutes les annonces, y compris celles sans note de CPE.</p>
                ) : (
                  <>
                    <div className="ds-chips" style={{ marginTop: 12 }}>
                      {CPE.map((c) => (
                        <span key={c} className="ds-chip" data-on={cpe.includes(c)} onClick={() => toggleCpe(c)}>{c}</span>
                      ))}
                    </div>
                    <label className="exp-opt" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={includeNoCpe} onChange={(e) => setIncludeNoCpe(e.target.checked)} />
                      Garder aussi les biens <strong>sans note</strong> de CPE (note « en cours »)
                    </label>
                  </>
                )}
              </div>
            )}

            {hasImmotop && (
              <div>
                <span className="ds-label" style={{ display: "block", marginBottom: 8 }}>Performance · Immotop <span className="ds-muted" style={{ fontWeight: 400 }}>(par bande, indicatif)</span></span>
                <div className="ds-chips">
                  {([["", "Toutes"], ["excellente", "Excellente"], ["moyenne", "Moyenne"], ["basse", "Basse"]] as const).map(([k, lbl]) => (
                    <span key={k || "all"} className="ds-chip" data-on={immotopEnergy === k} onClick={() => setImmotopEnergy(k)}>{lbl}</span>
                  ))}
                </div>
                <p className="ds-hint">
                  Bandes « et mieux » : <strong>Excellente</strong> ≈ A–C · <strong>Moyenne</strong> ≈ D–F · <strong>Basse</strong> ≈ G–I.
                  Immotop ne donne pas la note exacte par bien (reste « — » dans le tableau).
                </p>
              </div>
            )}
          </div></div>

          {/* ── État (Immotop) ─────────────────────────────────────────────── */}
          {hasImmotop && (
            <>
              <div className="ds-section"><span className="ds-h2">État du bien</span><span className="ds-rule" /></div>
              <div className="ds-card"><div className="ds-card__body">
                <span className="ds-label" style={{ display: "block", marginBottom: 8 }}>État de rénovation · Immotop</span>
                <div className="ds-chips">
                  {([["a_renover", "À rénover"], ["habitable", "Habitable"], ["renove", "Rénové"]] as const).map(([k, lbl]) => (
                    <span key={k} className="ds-chip" data-on={conditions.includes(k)} onClick={() => toggleCondition(k)}>{lbl}</span>
                  ))}
                </div>
                <p className="ds-hint">
                  Propre à Immotop (atHome ne le fournit pas). Vide = tous les états ;
                  les biens dont Immotop ne renseigne pas l'état sont écartés si tu filtres.
                </p>
              </div></div>
            </>
          )}
        </>
      )}

      {err && <div className="ds-error">{err}</div>}

      <div className="ds-toolbar" style={{ marginTop: 22, background: "transparent", border: "none", padding: 0 }}>
        <button className="ds-btn ds-btn--primary" onClick={() => save(true)} disabled={busy}>
          {busy ? "…" : "Enregistrer & lancer"}
        </button>
        <button className="ds-btn ds-btn--ghost" onClick={() => save(false)} disabled={busy}>
          Enregistrer seulement
        </button>
      </div>
    </div>
  );
}
