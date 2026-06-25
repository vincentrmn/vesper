// Export d'une recherche (analyse + tableau de comparables).
//  - Excel (.xlsx) : feuille « Analyse » (synthèse) + feuille « Comparables ».
//  - PDF : page de synthèse (fourchette, distribution, moyennes) + tableau ;
//    extensible (option) avec une fiche par bien (photos + détails).
// Génération côté navigateur (imports dynamiques). Photos via /api/imgproxy (CORS).
// Repris/adapté de BBIscout (exportTracked.ts).

export type ExportComparable = {
  title: string;
  commune: string;
  url: string;
  price: number;
  surface: number | string;
  priceM2: number | null;
  rooms?: number | null;
  cpe?: string | null;
  source?: string;
  etat?: string | null;
  marketStatus?: string;
  buildYear?: number | null;
  photos?: string[];
  description?: string | null;
};

export type ExportAnalysis = {
  commune?: string | null;
  nComps: number;
  enough: boolean;
  displayed?: { min: number; p25: number; median: number; p75: number; max: number };
  signedRef?: { signed: number; period: string } | null;
  decotePct?: number;
  decoteSource?: string;
  estimate?: { low: number; median: number; high: number };
  confidence?: number;
  confLabel?: string;
  avgSurface: number | null;
  avgPrice: number | null;
  avgM2: number | null;
};

const eur = (n?: number | null) =>
  n == null ? "—" : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €";
const SRC_LABEL: Record<string, string> = { athome: "atHome", immotop: "Immotop", both: "atHome+Immotop" };
const ETAT_LABEL: Record<string, string> = { a_renover: "À rénover", habitable: "Habitable", renove: "Rénové" };
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "vesper";
const proxied = (url: string) => `/api/imgproxy?url=${encodeURIComponent(url)}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// ---- Excel ----------------------------------------------------------------

export async function exportExcel(comps: ExportComparable[], a: ExportAnalysis, baseName: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Feuille Analyse (synthèse en lignes clé/valeur).
  const ana: [string, string | number][] = [
    ["Commune", a.commune || "—"],
    ["Comparables retenus", a.nComps],
    ["Surface moyenne (m²)", a.avgSurface != null ? Math.round(a.avgSurface * 10) / 10 : "—"],
    ["Prix moyen (€)", a.avgPrice != null ? Math.round(a.avgPrice) : "—"],
    ["€/m² moyen", a.avgM2 != null ? Math.round(a.avgM2) : "—"],
  ];
  if (a.enough && a.displayed) {
    ana.push(
      ["€/m² affiché — min", Math.round(a.displayed.min)],
      ["€/m² affiché — P25", Math.round(a.displayed.p25)],
      ["€/m² affiché — médiane", Math.round(a.displayed.median)],
      ["€/m² affiché — P75", Math.round(a.displayed.p75)],
      ["€/m² affiché — max", Math.round(a.displayed.max)],
      ["Décote affiché→signé (%)", a.decotePct ?? "—"],
      ["Réf. Observatoire signé (€/m²)", a.signedRef ? a.signedRef.signed : "—"],
      ["Estimation signée — basse (€/m²)", a.estimate ? a.estimate.low : "—"],
      ["Estimation signée — médiane (€/m²)", a.estimate ? a.estimate.median : "—"],
      ["Estimation signée — haute (€/m²)", a.estimate ? a.estimate.high : "—"],
      ["Confiance", `${a.confLabel} (${a.confidence})`]
    );
  }
  const wsA = XLSX.utils.aoa_to_sheet([["Analyse", ""], ...ana]);
  wsA["!cols"] = [{ wch: 34 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsA, "Analyse");

  // Feuille Comparables.
  const data = comps.map((c) => ({
    Bien: c.title,
    Source: SRC_LABEL[c.source || "athome"] || c.source,
    Commune: c.commune,
    "Prix (€)": c.price,
    "m²": c.surface,
    "€/m²": c.priceM2 ?? "",
    Chambres: c.rooms ?? "",
    CPE: c.cpe || "",
    État: c.etat ? ETAT_LABEL[c.etat] : "",
    Statut: c.marketStatus === "sold" ? "Vendu/compromis" : "Actif",
    "Année constr.": c.buildYear ?? "",
    Annonce: c.url,
  }));
  const wsC = XLSX.utils.json_to_sheet(data.length ? data : [{ Bien: "—" }]);
  wsC["!cols"] = Object.keys(data[0] || { Bien: "" }).map((k) =>
    k === "Bien" || k === "Annonce" || k === "Commune" ? { wch: 34 } : { wch: 13 }
  );
  XLSX.utils.book_append_sheet(wb, wsC, "Comparables");

  XLSX.writeFile(wb, `${safeName(baseName)}.xlsx`);
}

// ---- PDF ------------------------------------------------------------------

const INK: [number, number, number] = [17, 17, 17];
const SOFT: [number, number, number] = [110, 114, 112];
const GREEN: [number, number, number] = [7, 135, 95];

export async function exportPdf(
  comps: ExportComparable[],
  a: ExportAnalysis,
  baseName: string,
  opts: { photos: boolean; details: boolean }
) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 182;

  // --- Page de synthèse (Analyse) ---
  let y = 18;
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(`Analyse — ${a.commune || "comparables"}`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(...SOFT);
  doc.text(`${a.nComps} comparables retenus · généré le ${new Date().toLocaleDateString("fr-FR")}`, 14, y);
  y += 9;

  if (a.enough && a.estimate && a.displayed) {
    doc.setFontSize(13);
    doc.setTextColor(...GREEN);
    doc.text(`Estimation prix signé : ${eur(a.estimate.low)} – ${eur(a.estimate.high)} /m²  (méd. ${eur(a.estimate.median)})`, 14, y);
    y += 8;
    const synth: [string, string][] = [
      ["Affiché médian", `${eur(a.displayed.median)}/m²`],
      ["Décote affiché→signé", a.decotePct != null ? `−${a.decotePct} %` : "—"],
      ["Réf. Observatoire (signé)", a.signedRef ? `${eur(a.signedRef.signed)}/m² (${a.signedRef.period})` : "—"],
      ["Confiance", `${a.confLabel} (${a.confidence})`],
      ["Distribution €/m² affichés", `min ${eur(a.displayed.min)} · P25 ${eur(a.displayed.p25)} · méd ${eur(a.displayed.median)} · P75 ${eur(a.displayed.p75)} · max ${eur(a.displayed.max)}`],
      ["Moyennes", `${a.avgSurface != null ? Math.round(a.avgSurface) + " m²" : "—"} · ${eur(a.avgPrice)} · ${eur(a.avgM2)}/m²`],
    ];
    autoTable(doc, {
      startY: y,
      body: synth,
      theme: "plain",
      styles: { fontSize: 9.5, cellPadding: 1.6 },
      columnStyles: { 0: { textColor: SOFT, cellWidth: 56 }, 1: { textColor: INK, fontStyle: "bold" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  } else {
    doc.setFontSize(10);
    doc.setTextColor(...SOFT);
    doc.text("Pas assez de comparables retenus pour une estimation fiable.", 14, y);
    y += 8;
  }

  // --- Tableau des comparables (minimum) ---
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text("Comparables", 14, y);
  y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Bien", "Source", "Prix", "m²", "€/m²", "Ch.", "CPE", "État"]],
    body: comps.map((c) => [
      c.title?.slice(0, 46) || "—",
      SRC_LABEL[c.source || "athome"] || c.source || "",
      eur(c.price),
      String(c.surface),
      c.priceM2 != null ? eur(c.priceM2) : "—",
      c.rooms ?? "—",
      c.cpe || "—",
      (c.marketStatus === "sold" ? "Vendu · " : "") + (c.etat ? ETAT_LABEL[c.etat] : ""),
    ]),
    headStyles: { fillColor: [17, 17, 17], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.4 },
    columnStyles: { 0: { cellWidth: 56 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });

  // --- Fiches détaillées (option photos / détails) ---
  if (opts.photos || opts.details) {
    for (const c of comps) {
      doc.addPage();
      let yy = 16;
      doc.setFontSize(13);
      doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(c.title || "Annonce", W)[0], 14, yy);
      yy += 6;
      doc.setFontSize(9.5);
      doc.setTextColor(...SOFT);
      doc.text([c.commune, SRC_LABEL[c.source || "athome"], c.marketStatus === "sold" ? "Vendu/compromis" : ""].filter(Boolean).join("  ·  "), 14, yy);
      yy += 7;

      if (opts.photos && c.photos && c.photos.length) {
        const imgs = await Promise.all(c.photos.slice(0, 2).map((p) => loadImage(proxied(p))));
        const pw = 88, ph = 58;
        let drew = false;
        imgs.forEach((img, idx) => {
          if (img) {
            try { doc.addImage(img, "JPEG", 14 + idx * (pw + 6), yy, pw, ph); drew = true; } catch {}
          }
        });
        if (drew) yy += ph + 6;
      }

      const facts: [string, string][] = [
        ["Prix", eur(c.price)],
        ["Surface", `${c.surface} m²`],
        ["€/m²", c.priceM2 != null ? eur(c.priceM2) + "/m²" : "—"],
        ["Chambres", c.rooms != null ? String(c.rooms) : "—"],
        ["CPE", c.cpe || "—"],
        ["Année construction", c.buildYear != null ? String(c.buildYear) : "—"],
        ["État", c.etat ? ETAT_LABEL[c.etat] : "—"],
      ];
      autoTable(doc, {
        startY: yy,
        body: facts,
        theme: "plain",
        styles: { fontSize: 9.5, cellPadding: 1.4 },
        columnStyles: { 0: { textColor: SOFT, cellWidth: 56 }, 1: { fontStyle: "bold" } },
        margin: { left: 14, right: 14 },
      });
      yy = (doc as any).lastAutoTable.finalY + 5;

      if (opts.details && c.description) {
        doc.setFontSize(9);
        doc.setTextColor(...INK);
        const lines = doc.splitTextToSize(c.description, W);
        doc.text(lines.slice(0, 30), 14, yy);
        yy += Math.min(lines.length, 30) * 4 + 4;
      }
      doc.setFontSize(9.5);
      doc.setTextColor(...GREEN);
      if (c.url) doc.textWithLink("Voir l'annonce ↗", 14, yy + 2, { url: c.url });
    }
  }

  doc.save(`${safeName(baseName)}.pdf`);
}
