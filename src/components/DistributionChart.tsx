"use client";
// Graphique de distribution des €/m² affichés.
// Honnêteté (CLAUDE.md §0) : PAS une gaussienne paramétrique (qui supposerait
// une normalité qu'on n'a pas). On dessine une densité empirique lissée (KDE)
// à partir des vrais €/m², + un « rug » des points réels dessous pour montrer
// le nombre de comparables. Sous ~4 points : pas de courbe (marqueurs seuls).

type Quartiles = { min: number; p25: number; median: number; p75: number; max: number };

function gaussianKernel(u: number) {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

export default function DistributionChart({
  values,
  q,
  signed,
  estimate,
  fmt,
}: {
  values: number[];
  q: Quartiles;
  signed?: number | null;
  estimate?: { low: number; median: number; high: number } | null;
  fmt: (n: number) => string;
}) {
  const vals = values.filter((v) => typeof v === "number" && v > 0).sort((a, b) => a - b);
  const n = vals.length;

  // Géométrie (unités SVG ; le SVG s'étire à 100 % de la largeur).
  const W = 720, H = 264;
  const mL = 16, mR = 16, mT = 64, mB = 78;
  const plotW = W - mL - mR;
  const baseY = H - mB;
  const topY = mT;

  // Domaine x : englobe min/max, la réf signée et la fourchette estimée.
  const candLo = [q.min, signed ?? Infinity, estimate?.low ?? Infinity].filter((x) => isFinite(x));
  const candHi = [q.max, signed ?? -Infinity, estimate?.high ?? -Infinity].filter((x) => isFinite(x));
  let lo = Math.min(...candLo);
  let hi = Math.max(...candHi);
  if (!(hi > lo)) { lo = q.min - 1; hi = q.max + 1; }
  const padX = (hi - lo) * 0.06 || 1;
  lo -= padX; hi += padX;
  const sx = (v: number) => mL + ((v - lo) / (hi - lo)) * plotW;

  // KDE (Silverman) si assez de points et dispersion non nulle.
  const mean = vals.reduce((a, b) => a + b, 0) / (n || 1);
  const variance = n > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const showCurve = n >= 4 && std > 0;
  const h = showCurve ? 1.06 * std * Math.pow(n, -1 / 5) || 1 : 1;

  const K = 100;
  const xs = Array.from({ length: K + 1 }, (_, i) => lo + (i / K) * (hi - lo));
  const dens = xs.map((x) => vals.reduce((s, vi) => s + gaussianKernel((x - vi) / h), 0) / (n * h));
  const maxD = Math.max(...dens, 1e-9);
  const curveH = baseY - topY;
  const yOf = (dval: number) => baseY - (dval / maxD) * curveH;

  const areaPath = showCurve
    ? `M ${sx(xs[0]).toFixed(1)} ${baseY} ` +
      xs.map((x, i) => `L ${sx(x).toFixed(1)} ${yOf(dens[i]).toFixed(1)}`).join(" ") +
      ` L ${sx(xs[xs.length - 1]).toFixed(1)} ${baseY} Z`
    : "";

  // Hauteur de la courbe à une abscisse (pour ancrer les traits verticaux).
  const curveYAt = (v: number) => {
    if (!showCurve) return topY + curveH * 0.35;
    const dv = vals.reduce((s, vi) => s + gaussianKernel((v - vi) / h), 0) / (n * h);
    return yOf(dv);
  };

  const accent = "var(--ds-accent)";
  const accentInk = "var(--ds-accent-ink)";
  const ink = "var(--ds-ink)";
  const inkSoft = "var(--ds-ink-soft)";

  // Étiquettes d'axe (valeur + clé) ; extrêmes ancrés aux bords.
  // Médiane volontairement absente de l'axe : elle a déjà son label en haut.
  const axis: { v: number; k: string; anchor: "start" | "middle" | "end" }[] = [
    { v: q.min, k: "Min", anchor: "start" },
    { v: q.p25, k: "P25", anchor: "middle" },
    { v: q.p75, k: "P75", anchor: "middle" },
    { v: q.max, k: "Max", anchor: "end" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label="Distribution des prix au m² affichés" style={{ display: "block", overflow: "visible" }}>
      {/* Bande P25–P75 (moitié centrale) */}
      <rect x={sx(q.p25)} y={topY} width={Math.max(0, sx(q.p75) - sx(q.p25))} height={baseY - topY}
        fill={accent} opacity={0.1} />

      {/* Densité empirique lissée */}
      {showCurve && <path d={areaPath} fill={accent} opacity={0.16} stroke={accent} strokeWidth={1.5} />}

      {/* Ligne de base */}
      <line x1={mL} y1={baseY} x2={W - mR} y2={baseY} stroke="var(--ds-line-2)" strokeWidth={1} />

      {/* Rug : un tick par comparable réel (montre le n) */}
      {vals.map((v, i) => (
        <line key={i} x1={sx(v)} y1={baseY} x2={sx(v)} y2={baseY + 7} stroke={inkSoft} strokeWidth={1.5} opacity={0.55} />
      ))}

      {/* Médiane affichée */}
      <line x1={sx(q.median)} y1={curveYAt(q.median) - 4} x2={sx(q.median)} y2={baseY} stroke={accentInk} strokeWidth={2} />
      <g transform={`translate(${sx(q.median)}, ${topY - 30})`}>
        <text textAnchor="middle" fontSize={12} fontWeight={700} fill={accentInk}>Médiane affichée</text>
        <text y={15} textAnchor="middle" fontSize={14} fontWeight={800} fill={accentInk}>{fmt(q.median)}</text>
      </g>

      {/* Référence Observatoire (prix signé) */}
      {signed != null && (
        <>
          <line x1={sx(signed)} y1={topY - 6} x2={sx(signed)} y2={baseY} stroke={ink} strokeWidth={1.6} strokeDasharray="4 3" />
          {/* Label sous l'axe, sur sa propre ligne (évite la collision P25/Méd.) */}
          <g transform={`translate(${sx(signed)}, ${baseY + 52})`}>
            <text textAnchor="middle" fontSize={11} fontWeight={700} fill={ink}>Signé · Observatoire</text>
            <text y={14} textAnchor="middle" fontSize={13} fontWeight={800} fill={ink}>{fmt(signed)}</text>
          </g>
        </>
      )}

      {/* Étiquettes d'axe min/P25/méd/P75/max */}
      {axis.map((a, i) => (
        <g key={i} transform={`translate(${sx(a.v)}, ${baseY + 22})`}>
          <text textAnchor={a.anchor} fontSize={12} fontWeight={700} fill={ink} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(a.v)}</text>
          <text y={14} textAnchor={a.anchor} fontSize={10} fontWeight={700} fill={inkSoft}
            style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{a.k}</text>
        </g>
      ))}

      {!showCurve && (
        <text x={mL + plotW / 2} y={topY + 8} textAnchor="middle" fontSize={12} fontStyle="italic" fill={inkSoft}>
          Trop peu de comparables pour une courbe fiable — points réels ci-dessous.
        </text>
      )}
    </svg>
  );
}
