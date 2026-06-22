import { useState, useCallback } from "react";
import { jsPDF } from "jspdf";

// ─── PALETTE & DESIGN TOKENS ───────────────────────────────────────────────
// Deep laterite red · pale savanna · gold accent · dark schist · warm text
const C = {
  bg: "#F5F0E8",
  surface: "#FFFFFF",
  panel: "#FAF7F2",
  border: "#D4C8B0",
  gold: "#C49A22",
  goldLight: "#F0D87A",
  goldDark: "#8A6A0A",
  red: "#8B2A1A",
  redLight: "#C4442A",
  earth: "#4A3728",
  text: "#2C1F14",
  textMuted: "#7A6A58",
  success: "#2A6B3C",
  successBg: "#E8F5EC",
  warn: "#7A4A0A",
  warnBg: "#FDF3E0",
};

// ─── CONSTANTS (Burkina Faso, Code Minier 2024) ───────────────────────────
const BF = {
  redevanceRate: 0.08,        // 8% at gold ≥ 3500 USD/oz
  fmdRate: 0.01,              // Fonds Minier de Développement 1%
  taxeSuperfY1: 1500000 / 565.5,  // ~2653 USD/km²/an year 1
  taxeSuperfRenew: 3000000 / 565.5, // ~5305 USD/km²/an renewals
  permisOctroi: 7000000 / 565.5,   // ~12 376 USD
  discountRate: 0.10,
  goldSpot: 4500,             // USD/oz (March 2026)
  reservePriceFactor: 0.778,  // 1 - 22.2%
  cfaToUsd: 565.5,
  ozToG: 31.1035,
  // Cost base (Kavango analog adjusted +10% for BF context)
  miningCostPerTonne: 26,
  processingCostPerTonne: 38.5,  // 35 × 1.10
  sustainCapCostPerTonne: 5.5,   // 5 × 1.10
};

// ─── CAPEX TABLE (from thesis, scalable by capacity) ─────────────────────
function estimateCapex(capacityTPD, pitDepth, oreTonnage) {
  const s = capacityTPD / 250; // scale factor vs thesis base case
  const ds = Math.min(pitDepth / 50, 2); // depth scaling
  return {
    mine: Math.round((60000 + 50000 + 100000) * 1.8 * s * ds),
    crushing: Math.round(57800 * s),
    grinding: Math.round(41840 * s),
    cil: Math.round(129600 * s),
    vehicles: Math.round(120000 * s),
    energy: Math.round(49600 * s),
    lighting: Math.round(8680),
    water: Math.round(23000),
    infrastructure: Math.round(110000 * Math.pow(s, 0.6)),
    elution: Math.round(9000 * s),
    tooling: Math.round(750),
    ppe: Math.round(7605 * s),
    permis: Math.round(BF.permisOctroi),
    nies: 15000, // estimate
  };
}

// ─── OPEX TABLE (monthly) ─────────────────────────────────────────────────
function estimateOpex(capacityTPD, headcountScale) {
  const base = 140089.69;
  const s = capacityTPD / 250;
  // Reagents, fuel scale with capacity; salaries scale sub-linearly
  const reagents = 20185 * s;
  const fuel = 43626 * s;
  const salaries = 31343.26 * Math.pow(s * headcountScale, 0.75);
  const maintenance = 18000 * s;
  const food = 9000 * Math.pow(s, 0.6);
  const other = 5200 * Math.pow(s, 0.5);
  const subtotal = reagents + fuel + salaries + maintenance + food + other;
  return {
    reagents: Math.round(reagents),
    fuel: Math.round(fuel),
    salaries: Math.round(salaries),
    maintenance: Math.round(maintenance),
    food: Math.round(food),
    other: Math.round(other),
    contingency: Math.round(subtotal * 0.1),
    total: Math.round(subtotal * 1.1),
  };
}

// ─── FINANCIAL MODEL ─────────────────────────────────────────────────────
function calcFinancials({ capexTotal, opexMonthly, capacityTPD, grade, recovery, goldPriceUSD, permitAreaKm2 }) {
  const goldPerG = goldPriceUSD / BF.ozToG;
  const monthlyOre = capacityTPD * 30;
  const goldRecoveredMonthly = monthlyOre * grade * recovery;
  const revenueMonthly = goldRecoveredMonthly * goldPerG;

  // Deductions
  const redevance = revenueMonthly * BF.redevanceRate;
  const fmd = revenueMonthly * BF.fmdRate;
  const taxeY1 = BF.taxeSuperfY1 * permitAreaKm2;
  const taxeRenew = BF.taxeSuperfRenew * permitAreaKm2;

  const cashflowBrut = revenueMonthly - opexMonthly;
  const cashflowNetY1 = (cashflowBrut - redevance - fmd - taxeY1 / 12) * 12;
  const cashflowNetY2 = (cashflowBrut - redevance - fmd - taxeRenew / 12) * 12;
  const cashflowNetY3 = cashflowNetY2;

  const cf = [cashflowNetY1, cashflowNetY2, cashflowNetY3];
  const van = cf.reduce((acc, c, i) => acc + c / Math.pow(1 + BF.discountRate, i + 1), -capexTotal);

  // Conservative (50% gold price)
  const goldPriceConserv = goldPriceUSD * 0.5;
  const goldPerGConserv = goldPriceConserv / BF.ozToG;
  const revenueConserv = goldRecoveredMonthly * goldPerGConserv;
  const redevConserv = revenueConserv * BF.redevanceRate;
  const fmdConserv = revenueConserv * BF.fmdRate;
  const cashBrutConserv = revenueConserv - opexMonthly;
  const cfNetConservY1 = (cashBrutConserv - redevConserv - fmdConserv - taxeY1 / 12) * 12;
  const cfNetConservY2 = (cashBrutConserv - redevConserv - fmdConserv - taxeRenew / 12) * 12;
  const vanConserv = [cfNetConservY1, cfNetConservY2, cfNetConservY2].reduce(
    (acc, c, i) => acc + c / Math.pow(1 + BF.discountRate, i + 1), -capexTotal
  );

  const paybackMonths = revenueMonthly > opexMonthly
    ? Math.ceil(capexTotal / (cashflowBrut * 12) * 12)
    : null;

  return {
    goldPerG, monthlyOre, goldRecoveredMonthly,
    revenueMonthly, redevance, fmd,
    cashflowBrut, cashflowNetY1, cashflowNetY2,
    van, vanConserv, paybackMonths,
    revenueAnnual: revenueMonthly * 12,
    costPerTonne: opexMonthly / monthlyOre,
    marginPerTonne: (revenueMonthly - opexMonthly) / monthlyOre,
  };
}

// ─── CUT-OFF GRADE ────────────────────────────────────────────────────────
function calcCutoffGrade(goldPriceUSD) {
  const totalCostPerTonne = BF.miningCostPerTonne + BF.processingCostPerTonne + BF.sustainCapCostPerTonne;
  const goldPerG = goldPriceUSD / BF.ozToG;
  const cog = totalCostPerTonne / goldPerG;
  return { cog: Math.ceil(cog * 100) / 100, recommended: Math.ceil(cog * 100 + 5) / 100, totalCostPerTonne };
}

// ─── SENSITIVITY GRIDS (Gold price × Grade → VAN, stacked by Capacity) ────
// Capacité = choix de conception (contrôlé par l'exploitant), donc traité
// comme un scénario discret plutôt qu'un axe continu de la grille : pour
// chaque niveau de capacité, le CAPEX, l'OPEX et le calendrier d'épuisement
// changent tous ensemble, donc on recalcule une grille prix × teneur
// complète à chaque niveau plutôt que d'isoler son effet.
function calcSensitivityGrid({ capacityTPD, oreDepth, recovery, permitAreaKm2, centerGoldPrice, centerGrade }) {
  const goldFactors = [0.5, 0.75, 1.0, 1.25, 1.5];
  const gradeFactors = [0.7, 0.85, 1.0, 1.15, 1.3];
  const capacityFactors = [0.6, 1.0, 1.6]; // faible / base / élevée

  const goldPrices = goldFactors.map(f => centerGoldPrice * f);
  const grades = gradeFactors.map(f => centerGrade * f);

  const capacityLevels = capacityFactors.map(cf => {
    const capacity = capacityTPD * cf;
    const capex = estimateCapex(capacity, oreDepth);
    const capexTotal = Object.values(capex).reduce((a, b) => a + b, 0);
    const opex = estimateOpex(capacity, 1);

    const grid = grades.map(grade =>
      goldPrices.map(goldPriceUSD => {
        const fin = calcFinancials({
          capexTotal, opexMonthly: opex.total, capacityTPD: capacity,
          grade, recovery, goldPriceUSD, permitAreaKm2,
        });
        return fin.van;
      })
    );

    return { capacity, capacityFactor: cf, capexTotal, opexMonthly: opex.total, grid };
  });

  return { goldPrices, grades, capacityLevels, baseCapacityIndex: 1 };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
const fmt = (n, dec = 0) => n == null ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtUSD = (n) => `$${fmt(n)}`;
const fmtK = (n) => Math.abs(n) >= 1e6 ? `${n < 0 ? "-" : ""}$${fmt(Math.abs(n) / 1e6, 2)}M` : `${n < 0 ? "-" : ""}$${fmt(Math.abs(n) / 1e3, 1)}k`;

// ─── UI COMPONENTS ────────────────────────────────────────────────────────
const Label = ({ children }) => (
  <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted, marginBottom: 4 }}>
    {children}
  </label>
);

const Input = ({ label, value, onChange, type = "number", min, max, step, unit, hint }) => (
  <div style={{ marginBottom: 16 }}>
    <Label>{label}</Label>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={e => onChange(type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
        style={{
          flex: 1, padding: "8px 12px", borderRadius: 6,
          border: `1.5px solid ${C.border}`, background: C.surface,
          fontSize: 14, color: C.text, outline: "none",
          fontFamily: "inherit",
        }}
      />
      {unit && <span style={{ fontSize: 12, color: C.textMuted, whiteSpace: "nowrap" }}>{unit}</span>}
    </div>
    {hint && <p style={{ margin: "4px 0 0", fontSize: 11, color: C.textMuted }}>{hint}</p>}
  </div>
);

const Select = ({ label, value, onChange, options, hint }) => (
  <div style={{ marginBottom: 16 }}>
    <Label>{label}</Label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: "100%", padding: "8px 12px", borderRadius: 6,
        border: `1.5px solid ${C.border}`, background: C.surface,
        fontSize: 14, color: C.text, outline: "none", fontFamily: "inherit",
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    {hint && <p style={{ margin: "4px 0 0", fontSize: 11, color: C.textMuted }}>{hint}</p>}
  </div>
);

const Card = ({ title, accent, children, style = {} }) => (
  <div style={{
    background: C.surface, borderRadius: 10,
    border: `1.5px solid ${C.border}`,
    borderTop: `3px solid ${accent || C.gold}`,
    padding: "20px 24px", marginBottom: 20, ...style
  }}>
    {title && <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: accent || C.goldDark }}>{title}</h3>}
    {children}
  </div>
);

const MetricRow = ({ label, value, sub, highlight }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    padding: "8px 0", borderBottom: `1px solid ${C.border}`,
  }}>
    <span style={{ fontSize: 13, color: C.textMuted }}>{label}</span>
    <div style={{ textAlign: "right" }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: highlight || C.text }}>{value}</span>
      {sub && <span style={{ display: "block", fontSize: 11, color: C.textMuted }}>{sub}</span>}
    </div>
  </div>
);

const SectionTitle = ({ n, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "32px 0 16px" }}>
    <div style={{
      width: 32, height: 32, borderRadius: "50%", background: C.red,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0,
    }}>{n}</div>
    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.earth, letterSpacing: "0.04em" }}>{children}</h2>
  </div>
);

const VanBar = ({ label, van, maxAbs }) => {
  const positive = van >= 0;
  const w = Math.min(Math.abs(van) / maxAbs * 100, 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.textMuted }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: positive ? C.success : C.red }}>{fmtK(van)}</span>
      </div>
      <div style={{ background: C.border, borderRadius: 4, height: 8 }}>
        <div style={{ width: `${w}%`, height: 8, borderRadius: 4, background: positive ? C.success : C.redLight }} />
      </div>
    </div>
  );
};

const PhaseTag = ({ phase, color }) => (
  <span style={{
    display: "inline-block", padding: "2px 8px", borderRadius: 12,
    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    background: color + "22", color: color, border: `1px solid ${color}44`,
  }}>{phase}</span>
);

// Cellule de la grille de sensibilité, teinte selon la VAN
const SensCell = ({ van, isCenter }) => {
  const positive = van >= 0;
  const intensity = Math.min(Math.abs(van) / 400000, 1); // saturation cap
  const bg = positive
    ? `rgba(42,107,60,${0.08 + intensity * 0.3})`
    : `rgba(196,68,42,${0.08 + intensity * 0.3})`;
  return (
    <div style={{
      padding: "8px 4px", textAlign: "center", borderRadius: 5,
      background: bg,
      border: isCenter ? `2px solid ${C.goldDark}` : `1px solid ${C.border}`,
      fontSize: 11, fontWeight: isCenter ? 800 : 600,
      color: positive ? C.success : C.red,
    }}>
      {fmtK(van)}
    </div>
  );
};

// ─── PDF EXPORT ────────────────────────────────────────────────────────────
async function generatePdfReport({ depositName, ore, ops, effectiveGold, useReservePrice, results, sensitivity }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const { capex, capexTotal, opex, cog, fin } = results;

  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 48;
  let y = 0;

  const colors = {
    earth: [74, 55, 40],
    red: [139, 42, 26],
    gold: [138, 106, 10],
    success: [42, 107, 60],
    muted: [122, 106, 88],
    text: [44, 31, 20],
    border: [212, 200, 176],
  };

  const checkPageBreak = (needed = 60) => {
    if (y > doc.internal.pageSize.getHeight() - needed) {
      doc.addPage();
      y = 56;
    }
  };

  const drawHeaderBand = (title, subtitle) => {
    doc.setFillColor(...colors.earth);
    doc.rect(0, 0, pageW, 86, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(title, marginX, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(subtitle, marginX, 60);
    doc.setFontSize(8);
    doc.setTextColor(220, 210, 195);
    doc.text("Burkina Faso · Code Minier 2024", marginX, 75);
    y = 110;
  };

  const sectionTitle = (txt, color = colors.gold) => {
    checkPageBreak(50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...color);
    doc.text(txt.toUpperCase(), marginX, y);
    doc.setDrawColor(...colors.border);
    doc.line(marginX, y + 5, pageW - marginX, y + 5);
    y += 22;
  };

  const row = (label, value, sub) => {
    checkPageBreak(28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...colors.muted);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.text);
    const valW = doc.getTextWidth(String(value));
    doc.text(String(value), pageW - marginX - valW, y);
    y += 14;
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...colors.muted);
      const subW = doc.getTextWidth(sub);
      doc.text(sub, pageW - marginX - subW, y);
      y += 12;
    }
    doc.setDrawColor(...colors.border);
    doc.line(marginX, y - 2, pageW - marginX, y - 2);
    y += 6;
  };

  const totalRow = (label, value, color = colors.text) => {
    checkPageBreak(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...color);
    doc.text(label, marginX, y);
    const valW = doc.getTextWidth(String(value));
    doc.text(String(value), pageW - marginX - valW, y);
    y += 18;
  };

  const paragraph = (txt, size = 8.5, color = colors.muted) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(txt, pageW - marginX * 2);
    lines.forEach(line => {
      checkPageBreak(20);
      doc.text(line, marginX, y);
      y += size + 3;
    });
    y += 6;
  };

  // ── Page 1: Couverture / Résumé exécutif ──
  drawHeaderBand(depositName, "Rapport Technico-Économique — Modèle d'Investissement Progressif");

  sectionTitle("Résumé Exécutif", colors.red);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...colors.text);
  paragraph(
    `Gisement de ${fmt(ore.tonnes)} tonnes à ${ore.grade} g/t Au, exploité à ${ops.capacityTPD} t/j avec un taux de récupération de ${(ops.recovery * 100).toFixed(0)}%. Surface du permis Phase 1 : ${ops.permitAreaKm2} km².`
  );

  // KPI grid (2x2 boxes drawn manually)
  const kpis = [
    { label: "CAPEX Total", value: fmtK(capexTotal), color: colors.red },
    { label: "OPEX Mensuel", value: fmtK(opex.total), color: colors.earth },
    { label: "VAN (Base)", value: fmtK(fin.van), color: fin.van > 0 ? colors.success : colors.red },
    { label: "VAN (Conservateur)", value: fmtK(fin.vanConserv), color: fin.vanConserv > 0 ? colors.success : colors.red },
  ];
  const boxW = (pageW - marginX * 2 - 12) / 2;
  const boxH = 50;
  kpis.forEach((k, i) => {
    const col = i % 2, rowI = Math.floor(i / 2);
    const bx = marginX + col * (boxW + 12);
    const by = y + rowI * (boxH + 10);
    doc.setDrawColor(...colors.border);
    doc.setFillColor(250, 247, 242);
    doc.roundedRect(bx, by, boxW, boxH, 4, 4, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...colors.muted);
    doc.text(k.label.toUpperCase(), bx + 10, by + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...k.color);
    doc.text(k.value, bx + 10, by + 36);
  });
  y += 2 * (boxH + 10) + 10;

  if (fin.paybackMonths) {
    checkPageBreak(40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...colors.muted);
    doc.text(`Période de remboursement estimée : `, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.success);
    doc.text(`${fin.paybackMonths} mois`, marginX + 170, y);
    y += 20;
  }

  // ── Teneur de coupure ──
  sectionTitle("Teneur de Coupure Calculée");
  row("Coût de production total", `$${cog.totalCostPerTonne}/t`);
  row("Teneur de coupure calculée", `${cog.cog} g/t`);
  row("Teneur de coupure retenue (prudente)", `${cog.recommended} g/t`);
  row("Prix de réserve utilisé", `${fmtUSD(Math.round(effectiveGold))} USD/oz`, useReservePrice ? "−22,2% du cours spot" : "cours spot direct");

  // ── Contenu métallique ──
  sectionTitle("Contenu Métallique Phase 1");
  row("Tonnage Phase 1", `${fmt(ore.tonnes)} t`);
  row("Teneur moyenne", `${ore.grade} g/t Au`);
  row("Or contenu", `${fmt(ore.tonnes * ore.grade, 0)} g`, `${fmt(ore.tonnes * ore.grade / BF.ozToG, 0)} oz`);
  row("Or récupérable", `${fmt(ore.tonnes * ore.grade * ops.recovery, 0)} g`, `${fmt(ore.tonnes * ore.grade * ops.recovery / BF.ozToG, 0)} oz`);

  // ── CAPEX ──
  doc.addPage(); y = 56;
  sectionTitle("Coûts d'Investissement (CAPEX)", colors.red);
  [
    ["Mine (engins + camions)", capex.mine],
    ["Concassage", capex.crushing],
    ["Broyage", capex.grinding],
    ["Lixiviation CIL", capex.cil],
    ["Véhicules de service", capex.vehicles],
    ["Énergie (groupes électrogènes)", capex.energy],
    ["Éclairage", capex.lighting],
    ["Alimentation en eau", capex.water],
    ["Infrastructures (base vie, routes)", capex.infrastructure],
    ["Élution / Fonderie", capex.elution],
    ["EPI / Sécurité", capex.ppe],
    ["Permis d'exploitation (octroi)", capex.permis],
    ["NIES (estimation)", capex.nies],
  ].forEach(([l, v]) => row(l, fmtUSD(v)));
  totalRow("TOTAL CAPEX", fmtUSD(capexTotal), colors.red);

  y += 10;
  // ── OPEX ──
  sectionTitle("Coûts d'Exploitation Mensuels (OPEX)", colors.earth);
  [
    ["Réactifs (NaCN, CaO, charbon)", opex.reagents],
    ["Carburant", opex.fuel],
    ["Masse salariale", opex.salaries],
    ["Maintenance & explosifs", opex.maintenance],
    ["Alimentation personnel", opex.food],
    ["Autres charges", opex.other],
    ["Imprévus (10%)", opex.contingency],
  ].forEach(([l, v]) => row(l, fmtUSD(v)));
  totalRow("TOTAL OPEX / mois", fmtUSD(opex.total), colors.earth);
  row("Coût de production unitaire", `${fin.costPerTonne.toFixed(1)} USD/t`);

  // ── Revenus & marges ──
  doc.addPage(); y = 56;
  sectionTitle("Revenus & Marges Mensuels", colors.success);
  row("Prix de l'or utilisé", `${fmtUSD(Math.round(effectiveGold))}/oz`, useReservePrice ? "Prix de réserve (−22,2%)" : "Cours spot");
  row("Or récupéré / mois", `${fmt(fin.goldRecoveredMonthly, 0)} g`, `${fmt(fin.goldRecoveredMonthly / BF.ozToG, 1)} oz`);
  row("Chiffre d'affaires mensuel", fmtUSD(Math.round(fin.revenueMonthly)));
  row("OPEX mensuel", `(${fmtUSD(opex.total)})`);
  totalRow("Bénéfice brut mensuel", fmtUSD(Math.round(fin.cashflowBrut)), fin.cashflowBrut > 0 ? colors.success : colors.red);
  row("Valeur par tonne de minerai", `${fin.marginPerTonne.toFixed(1)} USD/t`);

  // ── Fiscalité ──
  sectionTitle("Fiscalité Minière — Burkina Faso", colors.gold);
  paragraph(`Appliquée au CA mensuel de ${fmtUSD(Math.round(fin.revenueMonthly))}.`);
  row("Redevance proportionnelle (8% · or ≥ 3 500 USD/oz)", `${fmtUSD(Math.round(fin.redevance))}/mois`);
  row("Fonds Minier de Développement (1% CA)", `${fmtUSD(Math.round(fin.fmd))}/mois`);
  row(`Taxe superficière (${ops.permitAreaKm2} km²)`, `${fmtUSD(Math.round(BF.taxeSuperfY1 * ops.permitAreaKm2))}/an (A1)`, `${fmtUSD(Math.round(BF.taxeSuperfRenew * ops.permitAreaKm2))}/an (A2+)`);
  row("Permis d'exploitation (octroi unique)", fmtUSD(Math.round(BF.permisOctroi)));
  checkPageBreak(40);
  doc.setFillColor(253, 243, 224);
  doc.roundedRect(marginX, y, pageW - marginX * 2, 26, 3, 3, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...colors.gold);
  doc.text("Paiement des redevances : délai 21 jours après pesée. Pénalité : 10%/jour de retard.", marginX + 8, y + 16);
  y += 38;

  // ── VAN ──
  doc.addPage(); y = 56;
  sectionTitle("Valeur Actuelle Nette — 3 ans (taux 10%)", colors.gold);
  row(`Scénario base (${fmtUSD(Math.round(effectiveGold))}/oz)`, fmtK(fin.van));
  row(`Scénario conservateur (${fmtUSD(Math.round(effectiveGold * 0.5))}/oz · −50%)`, fmtK(fin.vanConserv));
  paragraph(`Flux nets incluent les redevances, FMD et taxes superficières. CAPEX initial = ${fmtK(capexTotal)}.`);

  // ── Tableau de sensibilité (3 grilles empilées par niveau de capacité) ──
  y += 8;
  sectionTitle("Analyse de Sensibilité — VAN selon Prix de l'Or × Teneur × Capacité", colors.red);
  paragraph("Pour chaque niveau de capacité de traitement (qui détermine le CAPEX et l'OPEX), la grille croise teneur (lignes, g/t Au) et prix de l'or (colonnes, USD/oz). Cellule entourée en or = scénario de base retenu.");

  const nCols = sensitivity.goldPrices.length;
  const tableX = marginX;
  const tableW = pageW - marginX * 2;
  const firstColW = 64;
  const cellW = (tableW - firstColW) / nCols;
  const cellH = 22;
  const capacityLabels = ["Capacité faible", "Capacité de base", "Capacité élevée"];

  sensitivity.capacityLevels.forEach((lvl, levelIdx) => {
    const isBaseCapacity = levelIdx === sensitivity.baseCapacityIndex;
    checkPageBreak(cellH * (sensitivity.grades.length + 1) + 50);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...(isBaseCapacity ? colors.gold : colors.text));
    doc.text(
      `${capacityLabels[levelIdx]} — ${fmt(Math.round(lvl.capacity))} t/j${isBaseCapacity ? " (scénario actuel)" : ""}`,
      tableX, y
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...colors.muted);
    const capInfo = `CAPEX ${fmtK(lvl.capexTotal)} · OPEX ${fmtK(lvl.opexMonthly)}/mois`;
    doc.text(capInfo, pageW - marginX - doc.getTextWidth(capInfo), y);
    y += 14;

    // Header row
    doc.setFillColor(74, 55, 40);
    doc.rect(tableX, y, tableW, cellH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text("Teneur \\ Or", tableX + 6, y + cellH / 2 + 3);
    sensitivity.goldPrices.forEach((gp, i) => {
      const cx = tableX + firstColW + i * cellW + cellW / 2;
      const txt = `$${fmt(Math.round(gp))}`;
      doc.text(txt, cx - doc.getTextWidth(txt) / 2, y + cellH / 2 + 3);
    });
    y += cellH;

    sensitivity.grades.forEach((grade, ri) => {
      checkPageBreak(cellH + 10);
      // Label cell
      doc.setFillColor(250, 247, 242);
      doc.setDrawColor(...colors.border);
      doc.rect(tableX, y, firstColW, cellH, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...colors.text);
      doc.text(`${grade.toFixed(2)} g/t`, tableX + 6, y + cellH / 2 + 3);

      lvl.grid[ri].forEach((van, ci) => {
        const cx = tableX + firstColW + ci * cellW;
        const isCenter = isBaseCapacity && ri === 2 && ci === 2;
        const positive = van >= 0;
        const intensity = Math.min(Math.abs(van) / 400000, 1);
        if (positive) {
          doc.setFillColor(232 - intensity * 60, 245 - intensity * 40, 236 - intensity * 50);
        } else {
          doc.setFillColor(252 - intensity * 30, 225 - intensity * 60, 215 - intensity * 70);
        }
        doc.setDrawColor(...(isCenter ? colors.gold : colors.border));
        doc.setLineWidth(isCenter ? 1.2 : 0.5);
        doc.rect(cx, y, cellW, cellH, "FD");
        doc.setLineWidth(0.5);
        doc.setFont("helvetica", isCenter ? "bold" : "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...(positive ? colors.success : colors.red));
        const txt = fmtK(van);
        doc.text(txt, cx + cellW / 2 - doc.getTextWidth(txt) / 2, y + cellH / 2 + 3);
      });
      y += cellH;
    });
    y += 18;
  });
  y += 6;

  // ── Roadmap ──
  doc.addPage(); y = 56;
  sectionTitle("Schéma de Développement Progressif", colors.red);
  const phases = [
    { phase: "Préparation", period: "Mois 1–18", color: colors.earth, obj: "Construction, installation équipements, tests métallurgiques CIL", cond: "Attribution du permis + financement initial disponible", invest: fmtK(capexTotal) },
    { phase: "Phase 1 — Démarrage", period: "Mois 19–36", color: colors.red, obj: "Exploitation du Bloc prioritaire · génération de trésorerie · exploration continue", cond: "Validation mise en route (R–M18)", invest: "Autofinancé par revenus" },
    { phase: "Phase 2 — Consolidation", period: "Mois 37–48", color: colors.gold, obj: "Exploitation + exploration approfondie blocs B/C/D · optimisation procédé", cond: "CAPEX remboursé · tréso > $500k · récup. > 85% · 60% ressources mesurées", invest: "Trésorerie Phase 1" },
    { phase: "Phase 3 — Expansion", period: "Mois 49+", color: colors.success, obj: "Exploitation élargie aux blocs additionnels · renouvellement permis (3 ans)", cond: "Ressources indiquées ≥ 2 blocs · tréso > $1M · étude faisabilité positive", invest: "Trésorerie Phase 2 + renouvellement" },
  ];
  phases.forEach(p => {
    checkPageBreak(70);
    doc.setFillColor(...p.color);
    doc.rect(marginX, y - 10, 3, 56, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...p.color);
    doc.text(`${p.phase}  ·  ${p.period}`, marginX + 12, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...colors.text);
    const objLines = doc.splitTextToSize(p.obj, pageW - marginX * 2 - 12);
    objLines.forEach(l => { doc.text(l, marginX + 12, y); y += 11; });
    doc.setFontSize(7.5);
    doc.setTextColor(...colors.muted);
    const condLines = doc.splitTextToSize(`Condition : ${p.cond}`, pageW - marginX * 2 - 12);
    condLines.forEach(l => { doc.text(l, marginX + 12, y); y += 10; });
    doc.setTextColor(...colors.gold);
    doc.text(`Investissement : ${p.invest}`, marginX + 12, y);
    y += 24;
  });

  // ── Footer note ──
  checkPageBreak(80);
  doc.setDrawColor(...colors.border);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...colors.muted);
  paragraph(
    "Note méthodologique : Ce modèle applique la méthodologie de l'investissement progressif (Lankoandé, 2025). Les coûts CAPEX sont calibrés sur la plateforme Made-in-China avec coefficients d'ajustement (×1,3–1,8) pour coût rendu site. Les salaires sont basés sur Paylab BF. La teneur de coupure utilise l'analogie Kavango Resources (Zimbabwe, oct. 2025) ajustée +10% pour le contexte burkinabè. Tous les montants en USD (1 USD ≈ 565,5 FCFA). Fiscalité : Loi n° 016-2024/ALT du 18 juillet 2024 + décrets 2025.",
    7.5
  );

  // Page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...colors.muted);
    doc.text(`${i} / ${pageCount}`, pageW - marginX - 20, doc.internal.pageSize.getHeight() - 24);
    doc.text(depositName, marginX, doc.internal.pageSize.getHeight() - 24);
  }

  const safeName = depositName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "rapport";
  doc.save(`rapport_investissement_${safeName}.pdf`);
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function MineCalculator() {
  const [step, setStep] = useState(0); // 0=input, 1=results
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [sensCapacityIdx, setSensCapacityIdx] = useState(1); // 0=faible,1=base,2=élevée

  // Inputs
  const [depositName, setDepositName] = useState("Gombélédougou");
  const [ore, setOre] = useState({ tonnes: 254275, grade: 1.17, oreType: "oxide", depth: 50 });
  const [ops, setOps] = useState({ capacityTPD: 250, recovery: 0.90, permitAreaKm2: 1.0 });
  const [goldPrice, setGoldPrice] = useState(4500);
  const [useReservePrice, setUseReservePrice] = useState(true);

  const effectiveGold = useReservePrice ? goldPrice * BF.reservePriceFactor : goldPrice;

  const compute = useCallback(() => {
    const capex = estimateCapex(ops.capacityTPD, ore.depth, ore.tonnes);
    const capexTotal = Object.values(capex).reduce((a, b) => a + b, 0);
    const opex = estimateOpex(ops.capacityTPD, 1);
    const cog = calcCutoffGrade(effectiveGold);
    const fin = calcFinancials({
      capexTotal, opexMonthly: opex.total,
      capacityTPD: ops.capacityTPD,
      grade: ore.grade,
      recovery: ops.recovery,
      goldPriceUSD: effectiveGold,
      permitAreaKm2: ops.permitAreaKm2,
    });
    const sensitivity = calcSensitivityGrid({
      capacityTPD: ops.capacityTPD,
      oreDepth: ore.depth,
      recovery: ops.recovery,
      permitAreaKm2: ops.permitAreaKm2,
      centerGoldPrice: effectiveGold,
      centerGrade: ore.grade,
    });
    return { capex, capexTotal, opex, cog, fin, sensitivity };
  }, [ore, ops, effectiveGold]);

  const results = compute();

  const handleExportPdf = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await generatePdfReport({
        depositName, ore, ops, effectiveGold, useReservePrice,
        results, sensitivity: results.sensitivity,
      });
    } catch (err) {
      setExportError("Échec de l'export PDF. Vérifiez votre connexion et réessayez.");
    } finally {
      setExporting(false);
    }
  };

  const renderInput = () => (
    <div>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${C.earth} 0%, ${C.red} 100%)`,
        borderRadius: 12, padding: "28px 28px 24px", marginBottom: 28,
        color: "#fff", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", right: -20, top: -20, width: 120, height: 120,
          borderRadius: "50%", background: C.goldLight, opacity: 0.08,
        }} />
        <div style={{
          position: "absolute", right: 20, bottom: -30, width: 80, height: 80,
          borderRadius: "50%", background: C.gold, opacity: 0.1,
        }} />
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.7, marginBottom: 8 }}>
          Burkina Faso · Code Minier 2024
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 900, lineHeight: 1.2 }}>
          Modèle d'Investissement Progressif
        </h1>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
          Mines Aurifères Semi-Mécanisées — Calculateur Technico-Économique
        </p>
      </div>

      <SectionTitle n="A">Gisement</SectionTitle>
      <Card>
        <Input label="Nom du gisement / permis" value={depositName} onChange={setDepositName} type="text" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Input label="Tonnage de minerai (Bloc Phase 1)" value={ore.tonnes} onChange={v => setOre(p => ({ ...p, tonnes: v }))} unit="tonnes" hint="Ressources indiquées ou mesurées" />
          <Input label="Teneur moyenne" value={ore.grade} onChange={v => setOre(p => ({ ...p, grade: v }))} step={0.01} unit="g/t Au" hint="Au-dessus de la teneur de coupure" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Input label="Profondeur de la minéralisation" value={ore.depth} onChange={v => setOre(p => ({ ...p, depth: v }))} unit="m" hint="Profondeur max de la fosse Phase 1" />
          <Select
            label="Type de minerai dominant"
            value={ore.oreType}
            onChange={v => setOre(p => ({ ...p, oreType: v }))}
            options={[
              { value: "oxide", label: "Oxydé (Latérite / Saprolite)" },
              { value: "transition", label: "Transition" },
              { value: "fresh", label: "Roche fraîche" },
              { value: "mixed", label: "Mixte" },
            ]}
            hint="Influence la densité et la récupération"
          />
        </div>
      </Card>

      <SectionTitle n="B">Paramètres d'Exploitation</SectionTitle>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Input
            label="Capacité de traitement"
            value={ops.capacityTPD}
            onChange={v => setOps(p => ({ ...p, capacityTPD: v }))}
            unit="t/j"
            hint="Recommandé : 100–500 t/j pour semi-mécanisé"
            min={50} max={1000}
          />
          <Input
            label="Taux de récupération métallurgique"
            value={ops.recovery * 100}
            onChange={v => setOps(p => ({ ...p, recovery: v / 100 }))}
            unit="%" step={0.5} min={50} max={98}
            hint="CIL : 85–93% typical"
          />
        </div>
        <Input
          label="Superficie du permis (Phase 1)"
          value={ops.permitAreaKm2}
          onChange={v => setOps(p => ({ ...p, permitAreaKm2: v }))}
          unit="km²" step={0.1} min={0.1} max={1.5}
          hint="Maximum légal : 1,5 km² (Code Minier 2024, art. 78)"
        />
      </Card>

      <SectionTitle n="C">Prix de l'Or & Méthode de Valorisation</SectionTitle>
      <Card>
        <Input
          label="Cours spot de l'or (marché)"
          value={goldPrice}
          onChange={setGoldPrice}
          unit="USD/oz"
          hint="Cours observé : ~4 500 USD/oz (mars 2026)"
        />
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          background: useReservePrice ? C.warnBg : C.panel,
          border: `1px solid ${useReservePrice ? C.warn + "44" : C.border}`,
          borderRadius: 8, padding: 14, cursor: "pointer",
        }} onClick={() => setUseReservePrice(p => !p)}>
          <div style={{
            width: 18, height: 18, borderRadius: 4, border: `2px solid ${C.gold}`,
            background: useReservePrice ? C.gold : "transparent",
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {useReservePrice && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>✓</span>}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.earth, marginBottom: 2 }}>
              Appliquer la méthode du prix de réserve (−22,2%)
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Prix de réserve utilisé : <strong style={{ color: C.goldDark }}>{fmtUSD(Math.round(goldPrice * BF.reservePriceFactor))} USD/oz</strong> — Recommandé pour stress-test et classification des ressources
            </div>
          </div>
        </div>
      </Card>

      <button
        onClick={() => setStep(1)}
        style={{
          width: "100%", padding: "16px", borderRadius: 8,
          background: `linear-gradient(135deg, ${C.red}, ${C.redLight})`,
          color: "#fff", border: "none", cursor: "pointer",
          fontSize: 15, fontWeight: 800, letterSpacing: "0.06em",
          textTransform: "uppercase", marginTop: 8, marginBottom: 32,
        }}
      >
        Calculer le Modèle d'Investissement →
      </button>
    </div>
  );

  const renderResults = () => {
    const { capex, capexTotal, opex, cog, fin, sensitivity } = results;
    const maxVan = Math.max(Math.abs(fin.van), Math.abs(fin.vanConserv));
    const durationMonths = Math.ceil(ore.tonnes / (ops.capacityTPD * 30));

    return (
      <div>
        {/* Back + header */}
        <div style={{
          background: `linear-gradient(135deg, ${C.earth}, ${C.red})`,
          borderRadius: 12, padding: "20px 24px", marginBottom: 16, color: "#fff",
        }}>
          <button onClick={() => setStep(0)} style={{
            background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
            padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
            marginBottom: 10, fontFamily: "inherit",
          }}>← Modifier les paramètres</button>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900 }}>{depositName}</h2>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {fmt(ore.tonnes)} t · {ore.grade} g/t Au · {ops.capacityTPD} t/j · Phase 1
          </div>
        </div>

        {/* Export PDF button */}
        <button
          onClick={handleExportPdf}
          disabled={exporting}
          style={{
            width: "100%", padding: "14px", borderRadius: 8,
            background: exporting ? C.border : `linear-gradient(135deg, ${C.goldDark}, ${C.gold})`,
            color: exporting ? C.textMuted : "#fff", border: "none",
            cursor: exporting ? "default" : "pointer",
            fontSize: 13.5, fontWeight: 800, letterSpacing: "0.05em",
            textTransform: "uppercase", marginBottom: 20,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {exporting ? (
            <>
              <span style={{
                width: 14, height: 14, borderRadius: "50%",
                border: `2px solid ${C.textMuted}`, borderTopColor: "transparent",
                animation: "spin 0.8s linear infinite", display: "inline-block",
              }} />
              Génération du PDF…
            </>
          ) : (
            <>⬇ Exporter le Rapport Complet en PDF</>
          )}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {exportError && (
          <div style={{
            background: C.warnBg, border: `1px solid ${C.warn}44`, borderRadius: 8,
            padding: 10, fontSize: 12, color: C.warn, marginBottom: 20, textAlign: "center",
          }}>
            {exportError}
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[
            { label: "CAPEX Total", value: fmtK(capexTotal), color: C.red },
            { label: "OPEX Mensuel", value: fmtK(opex.total), color: C.earth },
            { label: "VAN (Base)", value: fmtK(fin.van), color: fin.van > 0 ? C.success : C.red },
            { label: "VAN (Conservateur)", value: fmtK(fin.vanConserv), color: fin.vanConserv > 0 ? C.success : C.red },
          ].map(k => (
            <div key={k.label} style={{
              background: C.surface, border: `1.5px solid ${C.border}`,
              borderTop: `3px solid ${k.color}`,
              borderRadius: 10, padding: "14px 16px",
            }}>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Cut-off grade */}
        <Card title="Teneur de Coupure Calculée" accent={C.goldDark}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 8 }}>
            {[
              { label: "Coût de production total", value: `$${cog.totalCostPerTonne}/t` },
              { label: "Teneur de coupure calculée", value: `${cog.cog} g/t` },
              { label: "Teneur de coupure retenue (prudente)", value: `${cog.recommended} g/t` },
            ].map(m => (
              <div key={m.label} style={{ textAlign: "center", padding: "12px 8px", background: C.panel, borderRadius: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.goldDark }}>{m.value}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{m.label}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
            Prix de réserve utilisé : <strong>{fmtUSD(Math.round(effectiveGold))} USD/oz</strong> ({useReservePrice ? "−22,2% du cours spot" : "cours spot direct"})
          </p>
        </Card>

        {/* Resource summary */}
        <Card title="Contenu Métallique Phase 1" accent={C.gold}>
          <MetricRow label="Tonnage Phase 1" value={`${fmt(ore.tonnes)} t`} />
          <MetricRow label="Teneur moyenne" value={`${ore.grade} g/t Au`} />
          <MetricRow label="Or contenu" value={`${fmt(ore.tonnes * ore.grade, 0)} g`} sub={`${fmt(ore.tonnes * ore.grade / BF.ozToG, 0)} oz`} />
          <MetricRow label={`Or récupérable (×${(ops.recovery * 100).toFixed(0)}%)`} value={`${fmt(ore.tonnes * ore.grade * ops.recovery, 0)} g`} sub={`${fmt(ore.tonnes * ore.grade * ops.recovery / BF.ozToG, 0)} oz`} highlight={C.success} />
          <MetricRow label="Durée d'exploitation estimée" value={`${durationMonths} mois`} sub={`Base: ${ops.capacityTPD} t/j`} />
        </Card>

        {/* CAPEX */}
        <Card title="Coûts d'Investissement (CAPEX)" accent={C.red}>
          {[
            ["Mine (engins + camions)", capex.mine],
            ["Concassage", capex.crushing],
            ["Broyage", capex.grinding],
            ["Lixiviation CIL", capex.cil],
            ["Véhicules de service", capex.vehicles],
            ["Énergie (groupes électrogènes)", capex.energy],
            ["Éclairage", capex.lighting],
            ["Alimentation en eau", capex.water],
            ["Infrastructures (base vie, routes)", capex.infrastructure],
            ["Élution / Fonderie", capex.elution],
            ["EPI / Sécurité", capex.ppe],
            ["Permis d'exploitation (octroi)", capex.permis],
            ["NIES (estimation)", capex.nies],
          ].map(([l, v]) => <MetricRow key={l} label={l} value={fmtUSD(v)} />)}
          <MetricRow label="TOTAL CAPEX" value={fmtUSD(capexTotal)} highlight={C.red} />
        </Card>

        {/* OPEX */}
        <Card title="Coûts d'Exploitation Mensuels (OPEX)" accent={C.earth}>
          {[
            ["Réactifs (NaCN, CaO, charbon)", opex.reagents],
            ["Carburant", opex.fuel],
            ["Masse salariale", opex.salaries],
            ["Maintenance & explosifs", opex.maintenance],
            ["Alimentation personnel", opex.food],
            ["Autres charges", opex.other],
            ["Imprévus (10%)", opex.contingency],
          ].map(([l, v]) => <MetricRow key={l} label={l} value={fmtUSD(v)} />)}
          <MetricRow label="TOTAL OPEX / mois" value={fmtUSD(opex.total)} highlight={C.earth} />
          <MetricRow label="Coût de production unitaire" value={`${fin.costPerTonne.toFixed(1)} USD/t`} />
        </Card>

        {/* Revenue & margin */}
        <Card title="Revenus & Marges Mensuels" accent={C.success}>
          <MetricRow label="Prix de l'or utilisé" value={`${fmtUSD(Math.round(effectiveGold))}/oz`} sub={useReservePrice ? "Prix de réserve (−22,2%)" : "Cours spot"} />
          <MetricRow label="Or récupéré/mois" value={`${fmt(fin.goldRecoveredMonthly, 0)} g`} sub={`${fmt(fin.goldRecoveredMonthly / BF.ozToG, 1)} oz`} />
          <MetricRow label="Chiffre d'affaires mensuel" value={fmtUSD(Math.round(fin.revenueMonthly))} />
          <MetricRow label="OPEX mensuel" value={`(${fmtUSD(opex.total)})`} />
          <MetricRow label="Bénéfice brut mensuel" value={fmtUSD(Math.round(fin.cashflowBrut))} highlight={fin.cashflowBrut > 0 ? C.success : C.red} />
          <MetricRow label="Valeur par tonne de minerai" value={`${fin.marginPerTonne.toFixed(1)} USD/t`} highlight={fin.marginPerTonne > 0 ? C.success : C.red} />
        </Card>

        {/* Burkina Faso fiscal */}
        <Card title="Fiscalité Minière — Burkina Faso (Code Minier 2024)" accent={C.goldDark}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
            Appliquée au CA mensuel de <strong>{fmtUSD(Math.round(fin.revenueMonthly))}</strong>
          </div>
          <MetricRow label="Redevance proportionnelle (8% · or ≥ 3 500 USD/oz)" value={`${fmtUSD(Math.round(fin.redevance))}/mois`} />
          <MetricRow label="Fonds Minier de Développement (1% CA)" value={`${fmtUSD(Math.round(fin.fmd))}/mois`} />
          <MetricRow
            label={`Taxe superficière (${ops.permitAreaKm2} km²)`}
            value={`${fmtUSD(Math.round(BF.taxeSuperfY1 * ops.permitAreaKm2))}/an (A1)`}
            sub={`${fmtUSD(Math.round(BF.taxeSuperfRenew * ops.permitAreaKm2))}/an (A2+)`}
          />
          <MetricRow label="Permis d'exploitation (octroi unique)" value={fmtUSD(Math.round(BF.permisOctroi))} />
          <div style={{ marginTop: 12, padding: 10, background: C.warnBg, borderRadius: 8, fontSize: 12, color: C.warn }}>
            ⚠ Paiement des redevances : délai 21 jours après pesée. Pénalité : 10%/jour de retard.
          </div>
        </Card>

        {/* VAN */}
        <Card title="Valeur Actuelle Nette — 3 ans (taux 10%)" accent={C.goldDark}>
          <VanBar label={`Scénario base (${fmtUSD(Math.round(effectiveGold))}/oz)`} van={fin.van} maxAbs={maxVan} />
          <VanBar label={`Scénario conservateur (${fmtUSD(Math.round(effectiveGold * 0.5))}/oz · −50%)`} van={fin.vanConserv} maxAbs={maxVan} />
          {fin.paybackMonths && (
            <div style={{ marginTop: 16, padding: 12, background: C.successBg, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 2 }}>Période de remboursement estimée</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.success }}>{fin.paybackMonths} mois</div>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: C.textMuted }}>
            Flux nets incluent les redevances, FMD et taxes superficières. CAPEX initial = {fmtK(capexTotal)}.
          </div>
        </Card>

        {/* Sensitivity table */}
        <Card title="Analyse de Sensibilité — VAN (Prix de l'Or × Teneur)" accent={C.red}>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: C.textMuted }}>
            Lignes : teneur (g/t Au) · Colonnes : prix de l'or (USD/oz). La cellule entourée en or est le scénario de base actuel.
          </p>

          {/* Capacity scenario selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {sensitivity.capacityLevels.map((lvl, idx) => {
              const isActive = idx === sensCapacityIdx;
              const isBase = idx === sensitivity.baseCapacityIndex;
              return (
                <button
                  key={idx}
                  onClick={() => setSensCapacityIdx(idx)}
                  style={{
                    flex: 1, padding: "8px 6px", borderRadius: 7,
                    border: isActive ? `2px solid ${C.goldDark}` : `1.5px solid ${C.border}`,
                    background: isActive ? C.goldLight + "33" : C.panel,
                    cursor: "pointer", fontFamily: "inherit", textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: isActive ? C.goldDark : C.text }}>
                    {fmt(Math.round(lvl.capacity))} t/j
                  </div>
                  <div style={{ fontSize: 9.5, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {idx === 0 ? "Capacité faible" : idx === 2 ? "Capacité élevée" : "Capacité base"}{isBase ? " ✓" : ""}
                  </div>
                </button>
              );
            })}
          </div>

          {(() => {
            const lvl = sensitivity.capacityLevels[sensCapacityIdx];
            const isBaseCapacity = sensCapacityIdx === sensitivity.baseCapacityIndex;
            return (
              <>
                <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 11, color: C.textMuted }}>
                  <span>CAPEX : <strong style={{ color: C.text }}>{fmtK(lvl.capexTotal)}</strong></span>
                  <span>OPEX/mois : <strong style={{ color: C.text }}>{fmtK(lvl.opexMonthly)}</strong></span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: `64px repeat(${sensitivity.goldPrices.length}, 1fr)`, gap: 4, minWidth: 480 }}>
                    {/* header row */}
                    <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, display: "flex", alignItems: "center" }}>g/t \ $/oz</div>
                    {sensitivity.goldPrices.map((gp, i) => (
                      <div key={i} style={{
                        fontSize: 10, fontWeight: 700, color: C.earth, textAlign: "center",
                        padding: "6px 2px", background: C.panel, borderRadius: 5,
                      }}>
                        {fmtUSD(Math.round(gp))}
                      </div>
                    ))}
                    {/* rows */}
                    {sensitivity.grades.map((grade, ri) => (
                      <>
                        <div key={`label-${ri}`} style={{
                          fontSize: 11, fontWeight: 700, color: C.earth, display: "flex",
                          alignItems: "center", padding: "0 4px",
                        }}>
                          {grade.toFixed(2)}
                        </div>
                        {lvl.grid[ri].map((van, ci) => (
                          <SensCell key={`${ri}-${ci}`} van={van} isCenter={isBaseCapacity && ri === 2 && ci === 2} />
                        ))}
                      </>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}

          <div style={{ marginTop: 12, fontSize: 11, color: C.textMuted, display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: C.success, opacity: 0.6 }} /> VAN positive
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: C.red, opacity: 0.6 }} /> VAN négative
            </span>
          </div>
        </Card>

        {/* Phase roadmap */}
        <Card title="Schéma de Développement Progressif" accent={C.red}>
          {[
            {
              phase: "Préparation", period: "Mois 1–18", color: C.earth,
              obj: "Construction, installation équipements, tests métallurgiques CIL",
              cond: "Attribution du permis + financement initial disponible",
              invest: fmtK(capexTotal),
            },
            {
              phase: "Phase 1 — Démarrage", period: "Mois 19–36", color: C.red,
              obj: "Exploitation du Bloc prioritaire · génération de trésorerie · exploration continue",
              cond: "Validation mise en route (R–M18)",
              invest: "Autofinancé par revenus",
            },
            {
              phase: "Phase 2 — Consolidation", period: "Mois 37–48", color: C.gold,
              obj: "Exploitation + exploration approfondie blocs B/C/D · optimisation procédé",
              cond: "CAPEX remboursé · tréso > $500k · récup. > 85% · 60% ressources mesurées",
              invest: "Trésorerie Phase 1",
            },
            {
              phase: "Phase 3 — Expansion", period: "Mois 49+", color: C.success,
              obj: "Exploitation élargie aux blocs additionnels · renouvellement permis (3 ans)",
              cond: "Ressources indiquées ≥ 2 blocs · tréso > $1M · étude faisabilité positive",
              invest: "Trésorerie Phase 2 + renouvellement",
            },
          ].map(p => (
            <div key={p.phase} style={{
              borderLeft: `3px solid ${p.color}`, paddingLeft: 14, marginBottom: 18,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <PhaseTag phase={p.phase} color={p.color} />
                <span style={{ fontSize: 12, color: C.textMuted }}>{p.period}</span>
              </div>
              <div style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>{p.obj}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                <strong>Condition :</strong> {p.cond}
              </div>
              <div style={{ fontSize: 11, color: C.goldDark, marginTop: 2 }}>
                <strong>Investissement :</strong> {p.invest}
              </div>
            </div>
          ))}
        </Card>

        {/* Disclaimer */}
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: 14, fontSize: 11, color: C.textMuted, marginBottom: 32,
          lineHeight: 1.6,
        }}>
          <strong style={{ color: C.earth }}>Note méthodologique :</strong> Ce modèle applique la méthodologie de l'investissement progressif (Lankoandé, 2025). Les coûts CAPEX sont calibrés sur la plateforme Made-in-China avec coefficients d'ajustement (×1,3–1,8) pour coût rendu site. Les salaires sont basés sur Paylab BF. La teneur de coupure utilise l'analogie Kavango Resources (Zimbabwe, oct. 2025) ajustée +10% pour le contexte burkinabè. Tous les montants en USD (1 USD ≈ 565,5 FCFA). Fiscalité : Loi n° 016-2024/ALT du 18 juillet 2024 + décrets 2025.
        </div>
      </div>
    );
  };

  return (
    <div style={{
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      background: C.bg, minHeight: "100vh",
      padding: "20px 16px",
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {step === 0 ? renderInput() : renderResults()}
      </div>
    </div>
  );
}
