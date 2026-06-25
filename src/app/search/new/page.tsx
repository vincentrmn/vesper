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
        immotopEnergy: hasImmotop && immotopEnergy ? immotopEnergy : undefined,
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
    <div className="wrap">
      <div className="topbar">
        <a className="brand-home" href="/" title="Accueil">VESPER</a>
        <h1 className="page-title">Nouvelle estimation</h1>
        <div className="topbar-nav">
          <a className="btn ghost" href="/">← Retour</a>
        </div>
      </div>

      <div className="card">
        <label>Nom de la recherche</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex : Appartements ~80m² Limpertsberg" />

        <div style={{ marginTop: 18 }}>
          <label>Sources</label>
          <div className="chips">
            <span className={`chip ${hasAthome ? "on" : ""}`} onClick={() => toggleSource("athome")}>atHome</span>
            <span className={`chip ${hasImmotop ? "on" : ""}`} onClick={() => toggleSource("immotop")}>Immotop</span>
          </div>
          <p className="zone-picker__hint" style={{ marginTop: 6 }}>
            {hasAthome && hasImmotop
              ? "Les biens présents sur les deux portails sont dédupliqués automatiquement (signalés « atHome + Immotop » dans les comparables)."
              : "Choisis atHome, Immotop, ou les deux. Chaque portail a ses propres filtres ci-dessous."}
          </p>
        </div>
      </div>

      {sources.length === 0 && <p className="empty">Choisis au moins une source pour configurer la recherche.</p>}

      {sources.length > 0 && (
        <>
          <div className="card">
            <div className="row">
              <div>
                <label>Type de bien</label>
                <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                  <option value="apartment">Appartement</option>
                  <option value="house">Maison</option>
                  <option value="both">Les deux</option>
                </select>
              </div>
              <div>
                <label>Construction</label>
                <select value={construction} onChange={(e) => setConstruction(e.target.value as any)}>
                  <option value="existant">Existant uniquement</option>
                  <option value="neuf">Neuf uniquement</option>
                  <option value="both">Existant + neuf</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <label>Localisation</label>
              <ZonePicker value={locCodes} onChange={setLocCodes} />
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <div><label>Surface min (m²)</label><input type="number" value={surfaceMin} onChange={(e) => setSurfaceMin(e.target.value)} /></div>
              <div><label>Surface max (m²)</label><input type="number" value={surfaceMax} onChange={(e) => setSurfaceMax(e.target.value)} /></div>
              <div><label>Prix min (€)</label><input type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} /></div>
              <div><label>Prix max (€)</label><input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} /></div>
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <div><label>Chambres min</label><input type="number" value={bedroomsMin} onChange={(e) => setBedroomsMin(e.target.value)} placeholder="ex : 2" /></div>
              <div><label>Année constr. min</label><input type="number" value={buildYearMin} onChange={(e) => setBuildYearMin(e.target.value)} placeholder="ex : 1990" /></div>
              <div><label>Année constr. max</label><input type="number" value={buildYearMax} onChange={(e) => setBuildYearMax(e.target.value)} /></div>
            </div>
            <p className="zone-picker__hint" style={{ marginTop: 6 }}>
              Année de construction : filtrée sur atHome quand l'annonce la renseigne (Immotop ne la fournit pas en liste).
            </p>
          </div>

          <div className="section-title">
            <h2>Énergie & état</h2>
            <span className="rule" />
          </div>
          <div className="card">
            {hasAthome && (
              <div>
                <label>Classes énergétiques · atHome</label>
                <div className="zone-picker__toggle-row" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
                  <Toggle checked={allCpe} onChange={setAllCpe} />
                  <span className="zone-picker__toggle-label">Toutes les notes CPE</span>
                </div>
                {!allCpe && (
                  <>
                    <div className="chips" style={{ marginTop: 12 }}>
                      {CPE.map((c) => (
                        <span key={c} className={`chip ${cpe.includes(c) ? "on" : ""}`} onClick={() => toggleCpe(c)}>{c}</span>
                      ))}
                    </div>
                    <div className="zone-picker__toggle-row" style={{ marginTop: 14, borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
                      <Toggle checked={includeNoCpe} onChange={setIncludeNoCpe} />
                      <span className="zone-picker__toggle-label">Inclure les biens sans note de CPE</span>
                    </div>
                    <p className="zone-picker__hint" style={{ marginTop: 6 }}>
                      Garde aussi les annonces dont le CPE est « en cours d'élaboration ».
                    </p>
                  </>
                )}
              </div>
            )}

            {hasImmotop && (
              <div style={{ marginTop: hasAthome ? 22 : 0, paddingTop: hasAthome ? 18 : 0, borderTop: hasAthome ? "1px solid var(--line)" : "none" }}>
                <label>Classes énergétiques · Immotop</label>
                <select value={immotopEnergy} onChange={(e) => setImmotopEnergy(e.target.value as any)}>
                  <option value="">Toutes</option>
                  <option value="excellente">Excellente — A à C</option>
                  <option value="moyenne">Moyenne — jusqu'à F (A–F)</option>
                  <option value="basse">Basse — toutes notées (A–I)</option>
                </select>
                <p className="zone-picker__hint" style={{ marginTop: 6 }}>
                  Immotop ne propose que ces 3 paliers <strong>cumulatifs</strong> (« cette qualité et mieux »),
                  pas la classe exacte comme atHome.
                </p>

                <label style={{ marginTop: 16 }}>État du bien · Immotop</label>
                <div className="chips">
                  {([["a_renover", "À rénover"], ["habitable", "Habitable"], ["renove", "Rénové"]] as const).map(([k, lbl]) => (
                    <span key={k} className={`chip ${conditions.includes(k) ? "on" : ""}`} onClick={() => toggleCondition(k)}>{lbl}</span>
                  ))}
                </div>
                <p className="zone-picker__hint" style={{ marginTop: 6 }}>
                  État de rénovation, propre à Immotop (atHome ne le fournit pas). Vide = tous les états.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {err && <div className="error">{err}</div>}

      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn clay" onClick={() => save(true)} disabled={busy}>
          {busy ? "..." : "Enregistrer & lancer"}
        </button>
        <button className="btn ghost" onClick={() => save(false)} disabled={busy}>
          Enregistrer seulement
        </button>
      </div>
    </div>
  );
}
