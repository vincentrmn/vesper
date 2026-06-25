"use client";
// Graphique de distribution des €/m² affichés (visx).
// Honnêteté (CLAUDE.md §0) : histogramme RÉEL (axe Y = nombre de biens) + une
// densité lissée (KDE) en simple trait — pas une gaussienne paramétrique.
// Un seul aplat vert (les barres) pour rester lisible ; les repères (médiane,
// moyenne, signé Observatoire) sont des traits verticaux de styles distincts.
import { scaleLinear } from "@visx/scale";
import { Bar, LinePath, Line } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { curveBasis } from "@visx/curve";

type Quartiles = { min: number; p25: number; median: number; p75: number; max: number };

const gauss = (u: number) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);

export default function DistributionChart({
  values,
  q,
  signed,
  fmt,
}: {
  values: number[];
  q: Quartiles;
  signed?: number | null;
  fmt: (n: number) => string;
}) {
  const vals = values.filter((v) => typeof v === "number" && v > 0).sort((a, b) => a - b);
  const n = vals.length;

  const W = 720, H = 322;
  const m = { top: 78, right: 18, bottom: 60, left: 46 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const meanV = vals.reduce((a, b) => a + b, 0) / (n || 1);

  // Domaine x : englobe min/max + réf signée + moyenne.
  let lo = Math.min(q.min, signed ?? Infinity, meanV);
  let hi = Math.max(q.max, signed ?? -Infinity, meanV);
  if (!(hi > lo)) { lo = q.min - 1; hi = q.max + 1; }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;

  // Histogramme (comptes réels).
  const B = Math.min(Math.max(Math.ceil(Math.sqrt(n)) + 1, 6), 14);
  const bw = (hi - lo) / B;
  const bins = Array.from({ length: B }, (_, i) => ({ x0: lo + i * bw, x1: lo + (i + 1) * bw, c: 0 }));
  vals.forEach((v) => { const i = Math.min(B - 1, Math.max(0, Math.floor((v - lo) / bw))); bins[i].c++; });
  const maxCount = Math.max(1, ...bins.map((b) => b.c));

  // Densité lissée (KDE Silverman), en « biens attendus par tranche ».
  const std = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - meanV) ** 2, 0) / (n - 1)) : 0;
  const showCurve = n >= 4 && std > 0;
  const h = 1.06 * std * Math.pow(n, -1 / 5) || 1;
  const K = 120;
  const curve = Array.from({ length: K + 1 }, (_, i) => {
    const x = lo + (i / K) * (hi - lo);
    const dens = vals.reduce((s, vi) => s + gauss((x - vi) / h), 0) / (n * h);
    return { x, y: dens * n * bw };
  });
  const yMax = Math.max(maxCount, showCurve ? Math.max(...curve.map((p) => p.y)) : 0) * 1.1;

  const xScale = scaleLinear({ domain: [lo, hi], range: [0, iw] });
  const yScale = scaleLinear({ domain: [0, yMax], range: [ih, 0], nice: true });

  const accent = "var(--ds-accent)";
  const accentInk = "var(--ds-accent-ink)";
  const ink = "var(--ds-ink)";
  const inkSoft = "var(--ds-ink-soft)";
  const line2 = "var(--ds-line-2)";

  const kEur = (v: number) => `${Math.round(v / 100) / 10}k`;

  // Repères verticaux. Étiquettes décalées en hauteur quand deux repères sont
  // proches horizontalement (médiane et moyenne sont souvent quasi confondues).
  type Mark = { x: number; label: string; value: string; color: string; dash?: string; lw: number };
  const marks: Mark[] = [
    { x: q.median, label: "Médiane", value: fmt(q.median), color: accentInk, lw: 2 },
    { x: meanV, label: "Moyenne", value: fmt(Math.round(meanV)), color: inkSoft, lw: 1.5, dash: "4 3" },
  ];
  if (signed != null) marks.push({ x: signed, label: "Signé · Obs.", value: fmt(signed), color: ink, lw: 1.6, dash: "5 3" });

  const ordered = marks.map((mk, idx) => ({ mk, px: xScale(mk.x), idx })).sort((a, b) => a.px - b.px);
  const levelOf: number[] = [];
  let lastPx = -Infinity, lastLevel = 0;
  ordered.forEach(({ px, idx }) => {
    const level = px - lastPx < 92 ? lastLevel + 1 : 0;
    levelOf[idx] = level;
    lastPx = px; lastLevel = level;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", height: "auto", overflow: "visible" }}
      role="img" aria-label="Distribution des prix au m² affichés">
      <Group left={m.left} top={m.top}>
        {/* Histogramme réel — seul aplat vert */}
        {bins.map((b, i) => {
          const x = xScale(b.x0); const w = Math.max(0, xScale(b.x1) - xScale(b.x0) - 1.5);
          const y = yScale(b.c);
          return <Bar key={i} x={x} y={y} width={w} height={ih - y} fill={accent} opacity={0.18} rx={2} />;
        })}

        {/* Densité lissée — simple trait (pas de remplissage) */}
        {showCurve && (
          <LinePath data={curve} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} curve={curveBasis}
            stroke={accent} strokeWidth={2} fill="none" />
        )}

        {/* Rug : un tick épais par comparable réel */}
        {vals.map((v, i) => (
          <line key={i} x1={xScale(v)} y1={ih} x2={xScale(v)} y2={ih - 11} stroke={accentInk} strokeWidth={2} opacity={0.8} />
        ))}

        {/* Repères verticaux + cartouches décalés */}
        {marks.map((mk, i) => {
          const px = xScale(mk.x);
          const ty = -14 - levelOf[i] * 26;
          return (
            <g key={i}>
              <Line from={{ x: px, y: 0 }} to={{ x: px, y: ih }} stroke={mk.color} strokeWidth={mk.lw}
                strokeDasharray={mk.dash} />
              <g transform={`translate(${px}, ${ty})`}>
                <text textAnchor="middle" fontSize={10} fontWeight={700} fill={inkSoft}
                  style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{mk.label}</text>
                <text y={13} textAnchor="middle" fontSize={13} fontWeight={800} fill={mk.color}
                  style={{ fontVariantNumeric: "tabular-nums" }}>{mk.value}</text>
              </g>
            </g>
          );
        })}

        {/* Axes — fontFamily "inherit" pour rester sur Inter (visx force Arial par défaut). */}
        <AxisLeft scale={yScale} numTicks={4} hideAxisLine tickStroke={line2}
          tickLabelProps={() => ({ fill: inkSoft, fontSize: 11, fontFamily: "inherit", textAnchor: "end", dx: -2, dy: 3 })}
          label="Nombre de biens" labelProps={{ fill: inkSoft, fontSize: 11, fontFamily: "inherit", fontWeight: 700, textAnchor: "middle" }} labelOffset={28} />
        <AxisBottom scale={xScale} top={ih} numTicks={6} stroke={line2} tickStroke={line2}
          tickFormat={(v) => kEur(v as number)}
          tickLabelProps={() => ({ fill: ink, fontSize: 11, fontFamily: "inherit", fontWeight: 600, textAnchor: "middle", dy: 2 })}
          label="Prix affiché (€/m²)" labelProps={{ fill: inkSoft, fontSize: 11, fontFamily: "inherit", fontWeight: 700, textAnchor: "middle" }} labelOffset={22} />

        {!showCurve && (
          <text x={iw / 2} y={12} textAnchor="middle" fontSize={12} fontStyle="italic" fill={inkSoft}>
            Trop peu de comparables pour une courbe fiable — histogramme et points réels seulement.
          </text>
        )}
      </Group>
    </svg>
  );
}
