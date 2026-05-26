"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import type { Invoice } from "@/lib/types";
import { t } from "@/lang";
import PieChart from "./PieChart";

type StatsPayload = {
  totals: {
    gesamt_anzahl: number;
    gesamt_summe: number;
    avg_betrag: number;
    eingang_summe: number;
    ausgang_summe: number;
    netto_cashflow: number;
  };
  top: {
    zeitraum: string | null;
    kategorie: string | null;
    lieferant: string | null;
  };
  alerts: {
    offene_ueberfaellig: number;
    naechste_7_tage: number;
    niedrige_ocr: number;
  };
  trend30: number;
};

export function DashboardStatsClient() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activeTab, setActiveTab] = useState<"purchases" | "sales" | "all">("purchases");
  const [timeframe, setTimeframe] = useState<"7days" | "30days" | "all">("30days");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: string } | null>(null);
  const [activeBottomSlide, setActiveBottomSlide] = useState(0);

  useEffect(() => {
    async function loadData() {
      const [statsRes, invoicesRes] = await Promise.all([
        fetch("/api/stats", { cache: "no-store" }),
        fetch("/api/invoices?limit=180", { cache: "no-store" })
      ]);
      const statsData = (await statsRes.json()) as { stats?: StatsPayload; insights?: string[] };
      const invData = (await invoicesRes.json()) as { invoices?: Invoice[] };
      setStats(statsData.stats ?? null);
      setInsights(Array.isArray(statsData.insights) ? statsData.insights : []);
      setInvoices(Array.isArray(invData.invoices) ? invData.invoices : []);
    }
    void loadData();
  }, []);

  // Compute daily series based on active tab and timeframe
  const chartData = useMemo(() => {
    const numDays = timeframe === "7days" ? 7 : timeframe === "30days" ? 30 : 90;
    const today = new Date();

    const days = Array.from({ length: numDays }, (_, idx) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (numDays - 1 - idx));
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
      return { key, label, value: 0 };
    });

    const dayMap = new Map(days.map((d) => [d.key, d]));

    for (const inv of invoices) {
      if (activeTab === "purchases" && inv.rechnung_typ !== "eingang") continue;
      if (activeTab === "sales" && inv.rechnung_typ !== "ausgang") continue;
      const raw = String(inv.rechnungsdatum || inv.hochladezeit || "");
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      if (dayMap.has(key)) {
        dayMap.get(key)!.value += Number(inv.brutto_betrag ?? 0);
      }
    }
    return days;
  }, [invoices, activeTab, timeframe]);

  // SVG chart calculations
  const svgW = 900;
  const svgH = 220;
  const padX = 40;
  const padY = 20;

  const svgPoints = useMemo(() => {
    const max = Math.max(1, ...chartData.map((d) => d.value));
    return chartData.map((d, i) => ({
      x: padX + (i / Math.max(1, chartData.length - 1)) * (svgW - 2 * padX),
      y: padY + (1 - d.value / max) * (svgH - 2 * padY),
      ...d
    }));
  }, [chartData]);

  const bezierPath = useMemo(() => {
    if (svgPoints.length < 2) return "";
    let path = `M ${svgPoints[0].x} ${svgPoints[0].y}`;
    for (let i = 1; i < svgPoints.length; i++) {
      const prev = svgPoints[i - 1];
      const cur = svgPoints[i];
      const cpx = (prev.x + cur.x) / 2;
      path += ` C ${cpx} ${prev.y}, ${cpx} ${cur.y}, ${cur.x} ${cur.y}`;
    }
    return path;
  }, [svgPoints]);

  const areaPath = useMemo(() => {
    if (!bezierPath) return "";
    const first = svgPoints[0];
    const last = svgPoints[svgPoints.length - 1];
    return `${bezierPath} L ${last.x} ${svgH} L ${first.x} ${svgH} Z`;
  }, [bezierPath, svgPoints]);

  // Tab headline and sum
  const tabLabel = activeTab === "purchases" ? t.dashboard.purchaseReports : activeTab === "sales" ? t.dashboard.salesReports : t.dashboard.allReports;
  const tabSum = useMemo(() => {
    let sum = 0;
    for (const inv of invoices) {
      if (activeTab === "purchases" && inv.rechnung_typ !== "eingang") continue;
      if (activeTab === "sales" && inv.rechnung_typ !== "ausgang") continue;
      sum += Number(inv.brutto_betrag ?? 0);
    }
    return sum;
  }, [invoices, activeTab]);

  // Average OCR quality score
  const averageQualityScore = useMemo(() => {
    const scores = invoices.map((i) => Number(i.qualitaet_score ?? 0)).filter((s) => s > 0);
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }, [invoices]);

  const qualityPercent = useMemo(() => {
    const raw = averageQualityScore > 10 ? averageQualityScore : averageQualityScore * 10;
    return Math.max(0, Math.min(100, raw));
  }, [averageQualityScore]);

  // Categorization rate (% of invoices with a category)
  const categorizationRate = useMemo(() => {
    if (invoices.length === 0) return 0;
    const categorized = invoices.filter((i) => i.kategorie_id != null).length;
    return Math.round((categorized / invoices.length) * 100);
  }, [invoices]);

  // Budget conformity (example: ratio of total vs 10k budget)
  const budgetConformity = useMemo(() => {
    const total = stats?.totals.gesamt_summe ?? 0;
    return total > 0 ? Math.round((total / 10000) * 1000) / 10 : 0;
  }, [stats]);

  // Category share for progress bars
  const categoryShare = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of invoices) {
      const key = inv.kategorie_name || t.dashboard.uncategorized;
      map.set(key, (map.get(key) ?? 0) + Number(inv.brutto_betrag ?? 0));
    }
    const top = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
    const total = top.reduce((sum, item) => sum + item.value, 0) || 1;
    return top.map((item) => ({ ...item, pct: (item.value / total) * 100 }));
  }, [invoices]);

  // Pie chart data for category spending
  const pieChartData = useMemo(() => {
    const palette = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"];
    return categoryShare.map((item, idx) => ({
      label: item.name,
      value: item.value,
      color: palette[idx % palette.length]
    }));
  }, [categoryShare]);

  const analytics = useMemo(() => {
    const monthKeys = Array.from({ length: 6 }, (_, idx) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - idx));
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("de-DE", { month: "short" })
      };
    });
    const monthMap = new Map(monthKeys.map((m) => [m.key, { incoming: 0, outgoing: 0, categories: new Map<string, number>() }]));
    const supplierTotals = new Map<string, number>();
    const vatTotals = new Map<string, number>();
    const weekQuality = Array.from({ length: 8 }, (_, i) => ({ label: `W-${8 - i}`, sum: 0, count: 0 }));
    const recurringBySupplier = new Map<string, { total: number; count: number }>();
    let overdue = 0;
    let next7 = 0;
    let onTime = 0;

    const now = new Date();
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const topCats = new Map<string, number>();

    for (const inv of invoices) {
      const amount = Number(inv.brutto_betrag ?? 0);
      const date = new Date(String(inv.rechnungsdatum || inv.hochladezeit || ""));
      if (!Number.isNaN(date.getTime())) {
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const monthEntry = monthMap.get(monthKey);
        if (monthEntry) {
          if (inv.rechnung_typ === "eingang") monthEntry.incoming += amount;
          if (inv.rechnung_typ === "ausgang") monthEntry.outgoing += amount;
          const cat = inv.kategorie_name || t.dashboard.uncategorized;
          monthEntry.categories.set(cat, (monthEntry.categories.get(cat) ?? 0) + amount);
        }
      }

      const supplier = inv.lieferant || t.dashboard.unknown;
      supplierTotals.set(supplier, (supplierTotals.get(supplier) ?? 0) + amount);
      const rec = recurringBySupplier.get(supplier) ?? { total: 0, count: 0 };
      rec.total += amount;
      rec.count += 1;
      recurringBySupplier.set(supplier, rec);

      const vatAmount = Number(String(inv.mwst_betrag ?? "0").replace(",", "."));
      const vatRate = (String(inv.mwst_satz ?? "").replace("%", "").trim() || "0") + "%";
      if (Number.isFinite(vatAmount)) vatTotals.set(vatRate, (vatTotals.get(vatRate) ?? 0) + vatAmount);

      const due = new Date(String(inv.faelligkeitsdatum ?? ""));
      if (!Number.isNaN(due.getTime())) {
        if (due < now) overdue += 1;
        else if (due <= nextWeek) next7 += 1;
        else onTime += 1;
      } else {
        onTime += 1;
      }

      const q = Number(inv.qualitaet_score ?? 0);
      if (Number.isFinite(q) && q > 0) {
        const weekIndex = Math.min(7, Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 7))));
        const bucket = weekQuality[7 - weekIndex];
        if (bucket) {
          bucket.sum += q;
          bucket.count += 1;
        }
      }
    }

    for (const m of monthMap.values()) {
      for (const [k, v] of m.categories.entries()) topCats.set(k, (topCats.get(k) ?? 0) + v);
    }
    const topCategoryNames = Array.from(topCats.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

    const monthlyCashflow = monthKeys.map((m) => ({ label: m.label, ...monthMap.get(m.key)! }));
    const categoryTrend = monthlyCashflow.map((m) => {
      const total = topCategoryNames.reduce((sum, name) => sum + (m.categories.get(name) ?? 0), 0) || 1;
      return {
        label: m.label,
        segments: topCategoryNames.map((name, idx) => ({
          name,
          pct: ((m.categories.get(name) ?? 0) / total) * 100,
          color: ["#2563eb", "#ef4444", "#111827"][idx]
        }))
      };
    });

    const supplierSorted = Array.from(supplierTotals.entries()).sort((a, b) => b[1] - a[1]);
    const supplierTotalSum = supplierSorted.reduce((s, [, v]) => s + v, 0) || 1;
    let cumulative = 0;
    const pareto = supplierSorted.slice(0, 5).map(([name, value]) => {
      cumulative += (value / supplierTotalSum) * 100;
      return { name, value, cumulative };
    });

    const recurringTotal = Array.from(recurringBySupplier.values()).filter((x) => x.count > 1).reduce((s, x) => s + x.total, 0);
    const oneOffTotal = Array.from(recurringBySupplier.values()).filter((x) => x.count <= 1).reduce((s, x) => s + x.total, 0);

    const qualityLine = weekQuality.map((w) => ({
      label: w.label,
      value: w.count > 0 ? w.sum / w.count : 0
    }));

    return {
      monthlyCashflow,
      categoryTrend,
      pareto,
      taxDonut: Array.from(vatTotals.entries()).map(([rate, value], idx) => ({ label: `MwSt ${rate}`, value, color: ["#2563eb", "#ef4444", "#111827", "#64748b"][idx % 4] })),
      dueStatus: [
        { label: "Überfällig", value: overdue, color: "#ef4444" },
        { label: "7 Tage", value: next7, color: "#f59e0b" },
        { label: "Pünktlich", value: onTime, color: "#10b981" }
      ],
      qualityLine,
      recurringDonut: [
        { label: "Düzenli", value: recurringTotal, color: "#111827" },
        { label: "Tek Sefer", value: oneOffTotal, color: "#2563eb" }
      ],
    };
  }, [invoices]);

  // Supplier data for table
  const supplierData = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const inv of invoices) {
      if (inv.rechnung_typ !== "eingang") continue;
      const name = inv.lieferant || "Unbekannt";
      const entry = map.get(name) ?? { total: 0, count: 0 };
      entry.total += Number(inv.brutto_betrag ?? 0);
      entry.count++;
      map.set(name, entry);
    }
    const all = Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5);
    const max = Math.max(1, ...all.map(([, d]) => d.total));
    return all.map(([name, data]) => ({ name, ...data, pct: (data.total / max) * 100 }));
  }, [invoices]);

  const handleDotHover = useCallback(
    (e: React.MouseEvent<SVGCircleElement>, point: (typeof svgPoints)[0]) => {
      const rect = (e.target as SVGCircleElement).closest("svg")?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        label: point.label,
        value: `${point.value.toFixed(2)} EUR`
      });
    },
    []
  );

  const numDaysLabel = timeframe === "7days" ? "7" : timeframe === "30days" ? "30" : "90";

  return (
    <div className="stats-dashboard-page">
      {/* ─── Premium Chart Card ─── */}
      <section className="premium-chart-card">
        <div className="chart-card-top">
          <div className="chart-headline-group">
            <span className="chart-subtitle" style={{ textTransform: "uppercase", fontWeight: 700, letterSpacing: "1px", fontSize: "0.72rem", color: "#64748b" }}>
              {tabLabel}
            </span>
            <strong className="chart-big-number">
              {tabSum.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
            </strong>
            <span className="chart-subtitle">
              {t.dashboard.dailyAnalysis} <span className="highlight">{numDaysLabel} {t.dashboard.days}</span> {t.dashboard.inLast} {numDaysLabel} {t.dashboard.daysEnd}
            </span>
          </div>
          <div className="chart-tab-group">
            <button className={`chart-tab-btn ${activeTab === "purchases" ? "active" : ""}`} onClick={() => setActiveTab("purchases")}>
              {t.dashboard.incoming}
            </button>
            <button className={`chart-tab-btn ${activeTab === "sales" ? "active" : ""}`} onClick={() => setActiveTab("sales")}>
              {t.dashboard.outgoing}
            </button>
            <button className={`chart-tab-btn ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")}>
              {t.dashboard.all}
            </button>
          </div>
        </div>

        <div className="chart-canvas-container">
          <svg viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
            {bezierPath && (
              <path d={bezierPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
            )}
            {svgPoints.map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r="5"
                fill="#ffffff"
                stroke="#10b981"
                strokeWidth="2"
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => handleDotHover(e, pt)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
          </svg>
          {tooltip && (
            <div className="chart-tooltip-portal" style={{ left: tooltip.x, top: tooltip.y }}>
              <span className="chart-tooltip-title">{tooltip.label}</span>
              <span className="chart-tooltip-value">{tooltip.value}</span>
            </div>
          )}
        </div>

        <div className="chart-period-selectors">
          <button className={`period-btn ${timeframe === "7days" ? "active" : ""}`} onClick={() => setTimeframe("7days")}>
            {t.dashboard.last7Days}
          </button>
          <button className={`period-btn ${timeframe === "30days" ? "active" : ""}`} onClick={() => setTimeframe("30days")}>
            {t.dashboard.last30Days}
          </button>
          <button className={`period-btn ${timeframe === "all" ? "active" : ""}`} onClick={() => setTimeframe("all")}>
            {t.dashboard.total}
          </button>
        </div>
      </section>

      {/* ─── Dark KPI Banner ─── */}
      <section className="dark-kpi-banner">
        {/* KPI Card 1: AI Data Reliability */}
        <article className="dark-kpi-card">
          <div className="dark-kpi-info">
            <span className="dark-kpi-label">{t.dashboard.aiReliability}</span>
            <strong className="dark-kpi-value">{Math.round(averageQualityScore)}</strong>
            <span className="dark-kpi-sub">{t.dashboard.avgOcrAccuracy}</span>
          </div>
          <div className="dark-kpi-gauge">
            <svg width="72" height="72">
              <circle cx="36" cy="36" r="28" className="gauge-bg" strokeWidth="4.5" />
              <circle
                cx="36" cy="36" r="28"
                className="gauge-fill-glow"
                stroke="#38bdf8"
                strokeWidth="4.5"
                strokeDasharray="175.9"
                strokeDashoffset={175.9 - (175.9 * qualityPercent) / 100}
              />
            </svg>
            <span className="gauge-center-label">{Math.round(qualityPercent)}%</span>
          </div>
        </article>

        {/* KPI Card 2: Categorization Rate */}
        <article className="dark-kpi-card">
          <div className="dark-kpi-info">
            <span className="dark-kpi-label">{t.dashboard.categorizationRate}</span>
            <strong className="dark-kpi-value">{categorizationRate}%</strong>
            <span className="dark-kpi-sub">{t.dashboard.classificationCompleteness}</span>
          </div>
          <div className="dark-kpi-gauge">
            <svg width="72" height="72">
              <circle cx="36" cy="36" r="28" className="gauge-bg" strokeWidth="4.5" />
              <circle
                cx="36" cy="36" r="28"
                className="gauge-fill-glow"
                stroke="#a855f7"
                strokeWidth="4.5"
                strokeDasharray="175.9"
                strokeDashoffset={175.9 - (175.9 * categorizationRate) / 100}
              />
            </svg>
            <span className="gauge-center-label">OKR</span>
          </div>
        </article>

        {/* KPI Card 3: Budget Conformity (green highlight) */}
        <article className="dark-kpi-card highlight-green">
          <div className="dark-kpi-info">
            <span className="dark-kpi-label">{t.dashboard.budgetConformity}</span>
            <strong className="dark-kpi-value">{budgetConformity}%</strong>
            <span className="dark-kpi-sub">{t.dashboard.budgetVsMonthly}</span>
          </div>
          <div className="dark-kpi-gauge">
            <svg width="72" height="72">
              <circle cx="36" cy="36" r="28" className="gauge-bg" strokeWidth="4.5" />
              <circle
                cx="36" cy="36" r="28"
                className="gauge-fill-glow"
                stroke="#ffffff"
                strokeWidth="4.5"
                strokeDasharray="175.9"
                strokeDashoffset={175.9 - (175.9 * Math.min(budgetConformity, 100)) / 100}
              />
            </svg>
            <span className="gauge-center-label">10k</span>
          </div>
        </article>
      </section>

      {/* ─── Trend Strip ─── */}
      <section className="dashboard-trends-strip">
        <div className="trend-strip-card">
          <div className="trend-strip-icon">📅</div>
          <div className="trend-strip-info">
            <span className="trend-strip-label">{t.dashboard.highestSpendPeriod}</span>
            <span className="trend-strip-value">{stats?.top.zeitraum ?? "—"}</span>
          </div>
        </div>
        <div className="trend-strip-card">
          <div className="trend-strip-icon">📦</div>
          <div className="trend-strip-info">
            <span className="trend-strip-label">{t.dashboard.topCategory}</span>
            <span className="trend-strip-value">{stats?.top.kategorie ?? "—"}</span>
          </div>
        </div>
        <div className="trend-strip-card">
          <div className="trend-strip-icon">🏢</div>
          <div className="trend-strip-info">
            <span className="trend-strip-label">{t.dashboard.topSupplier}</span>
            <span className="trend-strip-value">{stats?.top.lieferant ?? "—"}</span>
          </div>
        </div>
      </section>

      {/* ─── Bottom Grid ─── */}
      <section className="stats-bottom-grid">
        {/* Left Column: Supplier Table */}
        <article className="stats-card-panel">
          <h3>{t.dashboard.topSuppliers}</h3>
          <table className="custom-stats-table">
            <thead>
              <tr>
                <th>{t.dashboard.partnerCompany}</th>
                <th>{t.dashboard.spendDistribution}</th>
                <th>{t.dashboard.amount}</th>
              </tr>
            </thead>
            <tbody>
              {supplierData.map((sup) => (
                <tr key={sup.name}>
                  <td>
                    <div className="table-row-flex">
                      <span className="table-row-title">{sup.name}</span>
                      <span className="table-row-sub">{t.dashboard.frequentPartner}</span>
                    </div>
                  </td>
                  <td>
                    <div className="premium-progress-track" style={{ width: "100%" }}>
                      <div
                        className={`premium-progress-fill ${sup.pct > 60 ? "" : "yellow-fill"}`}
                        style={{ width: `${sup.pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="table-value-bold">
                    {sup.total.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: "32px", borderTop: "1px solid #f1f5f9", paddingTop: "16px", marginTop: "12px" }}>
            <div>
              <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {t.dashboard.netCashflow}
              </span>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: (stats?.totals.netto_cashflow ?? 0) < 0 ? "#ef4444" : "#10b981" }}>
                {(stats?.totals.netto_cashflow ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
              </div>
            </div>
            <div>
              <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {t.dashboard.avgInvoice}
              </span>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#1e293b" }}>
                {(stats?.totals.avg_betrag ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
              </div>
            </div>
          </div>

          {/* ─── 8-Slide Analytics Carousel ─── */}
          <div className="pie-slider-block" style={{ marginTop: "16px" }}>
            <div className="pie-slider-head">
              <div>
                <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e293b" }}>
                  {[
                    "Aylık Cashflow",
                    "Kategori Dağılım Trendi",
                    "Tedarikçi Konsantrasyonu",
                    "Vergi (MwSt) Özeti",
                    "Vade / Gecikme Durumu",
                    "Belge Kalite & AI Güven",
                    "Düzenli vs Tek Sefer",
                  ][activeBottomSlide]}
                </h4>
              </div>
              <div className="pie-slider-controls">
                <button
                  type="button"
                  onClick={() => setActiveBottomSlide((prev) => (prev === 0 ? 6 : prev - 1))}
                  aria-label="Önceki"
                >←</button>
                <span>{activeBottomSlide + 1}/7</span>
                <button
                  type="button"
                  onClick={() => setActiveBottomSlide((prev) => (prev === 6 ? 0 : prev + 1))}
                  aria-label="Sonraki"
                >→</button>
              </div>
            </div>

            <div className="pie-slider-content">
              {activeBottomSlide === 0 && (
                <div className="analytics-cashflow-bars">
                  {analytics.monthlyCashflow.map((m) => {
                    const max = Math.max(1, ...analytics.monthlyCashflow.map((x) => Math.max(x.incoming, x.outgoing)));
                    return (
                      <div key={m.label} className="dual-bar-col">
                        <div className="dual-bars">
                          <span style={{ height: `${(m.incoming / max) * 100}%` }} className="bar-in" />
                          <span style={{ height: `${(m.outgoing / max) * 100}%` }} className="bar-out" />
                        </div>
                        <small>{m.label}</small>
                      </div>
                    );
                  })}
                </div>
              )}
              {activeBottomSlide === 1 && (
                <div className="stacked-bars">
                  {analytics.categoryTrend.map((m) => (
                    <div key={m.label} className="stacked-row">
                      <small>{m.label}</small>
                      <div className="stacked-track">
                        {m.segments.map((s) => (
                          <span key={s.name} style={{ width: `${s.pct}%`, background: s.color }} title={`${s.name} ${s.pct.toFixed(0)}%`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeBottomSlide === 2 && (
                <div className="pareto-chart">
                  {analytics.pareto.map((p) => (
                    <div key={p.name} className="pareto-row">
                      <small>{p.name}</small>
                      <div className="pareto-bar"><span style={{ width: `${p.cumulative}%` }} /></div>
                      <strong>{p.cumulative.toFixed(0)}%</strong>
                    </div>
                  ))}
                </div>
              )}
              {activeBottomSlide === 3 && <PieChart data={analytics.taxDonut} radius={100} innerRadius={56} />}
              {activeBottomSlide === 4 && (
                <div className="triple-status">
                  {analytics.dueStatus.map((d) => (
                    <div key={d.label} className="status-card" style={{ borderColor: d.color }}>
                      <span>{d.label}</span>
                      <strong>{d.value}</strong>
                    </div>
                  ))}
                </div>
              )}
              {activeBottomSlide === 5 && (
                <div className="quality-line">
                  {analytics.qualityLine.map((q) => (
                    <div key={q.label} className="q-point-wrap">
                      <span className="q-point" style={{ bottom: `${q.value}%` }} />
                      <small>{q.label}</small>
                    </div>
                  ))}
                </div>
              )}
              {activeBottomSlide === 6 && <PieChart data={analytics.recurringDonut} radius={100} innerRadius={56} />}
            </div>
          </div>
        </article>

        {/* Right Column: Category Breakdown + Pie Chart + AI Recommendations */}
        <article className="stats-card-panel">
          <h3>{t.dashboard.categoryBudgetLimits}</h3>

          {/* Pie Chart - Category Spending */}
          <div style={{ display: "flex", alignItems: "center", gap: "24px", padding: "8px 0" }}>
            <PieChart data={pieChartData} radius={80} innerRadius={45} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
              {pieChartData.map((item) => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.82rem" }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                  <span style={{ color: "#475569", flex: 1 }}>{item.label}</span>
                  <strong style={{ color: "#1e293b" }}>
                    {item.value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} EUR
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {/* Category Progress Bars */}
          <div className="premium-progress-list" style={{ marginBottom: "20px" }}>
            {categoryShare.length === 0 ? (
              <span style={{ color: "#94a3b8", fontSize: "0.88rem" }}>{t.dashboard.noCategoryData}</span>
            ) : (
              categoryShare.map((cat, idx) => (
                <div className="premium-progress-item" key={`cat-${cat.name}`}>
                  <div className="premium-progress-head">
                    <span>{cat.name}</span>
                    <span className="item-val">
                      {cat.value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} EUR ({cat.pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="premium-progress-track">
                    <div
                      className={`premium-progress-fill ${
                        idx === 1 ? "yellow-fill" : idx === 2 ? "blue-fill" : idx === 3 ? "red-fill" : ""
                      }`}
                      style={{ width: `${cat.pct}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <h3 style={{ borderTop: "1px solid #f1f5f9", paddingTop: "16px", marginTop: "8px" }}>
            {t.dashboard.aiBudgetRecommendations}
          </h3>
          <ul className="stats-recommendations">
            {(insights.length > 0 ? insights : t.stats.fallbackInsights).slice(0, 3).map((insight, idx) => (
              <li key={`${idx}-${insight.slice(0, 24)}`}>{insight}</li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
