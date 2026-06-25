"use client";
import { useEffect, useState } from "react";
import type { ZoneTree } from "@/lib/types";

type Props = {
  value: string[];
  onChange: (locCodes: string[]) => void;
};

/**
 * ZonePicker — sélection de localisation avec toggle "Tout {ville}" + chips quartiers.
 *
 * Convention de l'état émis (value) :
 *   - ["L9-luxembourg"]                  → toggle "Tout Luxembourg-Ville" ON
 *   - ["L10-belair", "L10-merl", …]      → quartiers individuels
 *   - []                                 → aucune sélection (refusé par le formulaire)
 */
export default function ZonePicker({ value, onChange }: Props) {
  const [tree, setTree] = useState<ZoneTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/zones", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setTree(json.zones || []);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="zone-picker__loading">Chargement des zones…</p>;
  if (error)
    return <p className="zone-picker__error">Impossible de charger les zones ({error})</p>;
  if (tree.length === 0)
    return <p className="zone-picker__error">Aucune zone configurée.</p>;

  return (
    <div className="zone-picker">
      {tree.map((city) => (
        <CityPicker key={city.id} city={city} value={value} onChange={onChange} />
      ))}
    </div>
  );
}

function CityPicker({
  city,
  value,
  onChange,
}: {
  city: ZoneTree;
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const cityCode = city.loc_code;
  const quartierSet = new Set(city.quartiers.map((q) => q.loc_code));

  const isAll = value.includes(cityCode);
  const selectedQuartiers = value.filter((c) => quartierSet.has(c));

  function toggleAll() {
    if (isAll) {
      onChange(value.filter((c) => c !== cityCode));
    } else {
      // Activer "tout" → retirer le code ville + les quartiers de cette ville
      const others = value.filter((c) => c !== cityCode && !quartierSet.has(c));
      onChange([...others, cityCode]);
    }
  }

  function toggleQuartier(qCode: string) {
    // Si "tout" actif, on bascule en mode quartiers : on retire d'abord le code ville
    const base = isAll ? value.filter((c) => c !== cityCode) : value.slice();
    if (base.includes(qCode)) {
      onChange(base.filter((c) => c !== qCode));
    } else {
      onChange([...base, qCode]);
    }
  }

  return (
    <fieldset className="zone-picker__city">
      <legend>{city.label}</legend>

      <div className="zone-picker__toggle-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={isAll} onChange={toggleAll} />
          <span className="toggle-switch__slider" />
        </label>
        <span className="zone-picker__toggle-label">Tout {city.label}</span>
      </div>

      <div
        className={`chips zone-picker__quartiers ${isAll ? "is-disabled" : ""}`}
        aria-disabled={isAll}
      >
        {city.quartiers.map((q) => {
          const on = !isAll && value.includes(q.loc_code);
          return (
            <span
              key={q.id}
              className={`chip ${on ? "on" : ""}`}
              role="button"
              tabIndex={isAll ? -1 : 0}
              onClick={() => !isAll && toggleQuartier(q.loc_code)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !isAll) {
                  e.preventDefault();
                  toggleQuartier(q.loc_code);
                }
              }}
            >
              {q.label}
            </span>
          );
        })}
      </div>

      {!isAll && selectedQuartiers.length > 0 && (
        <p className="zone-picker__hint">
          {selectedQuartiers.length} quartier
          {selectedQuartiers.length > 1 ? "s" : ""} sélectionné
          {selectedQuartiers.length > 1 ? "s" : ""}
        </p>
      )}
    </fieldset>
  );
}
