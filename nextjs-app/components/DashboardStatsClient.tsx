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
  const [activePieSlide, setActivePieSlide] = useState(0);

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

  const pieSlides = useMemo(() => {
    const palette = ["#2563eb", "#ef4444", "#111827", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#64748b"];

    const incoming = Number(stats?.totals.eingang_summe ?? 0);
    const outgoing = Number(stats?.totals.ausgang_summe ?? 0);

    const supplierTotals = new Map<string, number>();
    const monthlyCategory = new Map<string, number>();
    const taxByRate = new Map<string, number>();
    const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
    let overdue = 0;
    let next7Days = 0;
    let noDue = 0;
    let qualityHigh = 0;
    let qualityMid = 0;
    let qualityLow = 0;
    let qualityMissing = 0;

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const nextWeek = new Date(now);
    nextWeek.setDate(now.getDate() + 7);

    for (const inv of invoices) {
      const amount = Number(inv.brutto_betrag ?? 0);
      const supplier = inv.lieferant || "Unbekannt";
      supplierTotals.set(supplier, (supplierTotals.get(supplier) ?? 0) + amount);

      const score = Number(inv.qualitaet_score ?? 0);
      if (!Number.isFinite(score) || score <= 0) qualityMissing += 1;
      else if (score >= 80) qualityHigh += 1;
      else if (score >= 50) qualityMid += 1;
      else qualityLow += 1;

      const dueText = String(inv.faelligkeitsdatum ?? "").trim();
      if (dueText) {
        const due = new Date(dueText);
        if (!Number.isNaN(due.getTime())) {
          if (due < now) overdue += 1;
          else if (due <= nextWeek) next7Days += 1;
        } else {
          noDue += 1;
        }
      } else {
        noDue += 1;
      }

      const rawDate = String(inv.rechnungsdatum || inv.hochladezeit || "");
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) {
        const day = (d.getDay() + 6) % 7;
        weekdayTotals[day] += amount;
        if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
          const cat = inv.kategorie_name || "Sonstige";
          monthlyCategory.set(cat, (monthlyCategory.get(cat) ?? 0) + amount);
        }
      }

      const vatAmount = Number(String(inv.mwst_betrag ?? "0").replace(",", "."));
      const vatRate = String(inv.mwst_satz ?? "").trim() || "Unbekannt";
      if (Number.isFinite(vatAmount) && vatAmount >= 0) {
        taxByRate.set(vatRate, (taxByRate.get(vatRate) ?? 0) + vatAmount);
      }
    }

    const supplierEntries = Array.from(supplierTotals.entries()).sort((a, b) => b[1] - a[1]);
    const topSuppliers = supplierEntries.slice(0, 5);
    const restSuppliers = supplierEntries.slice(5).reduce((sum, [, v]) => sum + v, 0);
    const topSupplierData = topSuppliers.map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
    if (restSuppliers > 0) topSupplierData.push({ label: "Andere", value: restSuppliers, color: "#94a3b8" });

    const monthCatEntries = Array.from(monthlyCategory.entries()).sort((a, b) => b[1] - a[1]);
    const monthTopCats = monthCatEntries.slice(0, 4);
    const monthOther = monthCatEntries.slice(4).reduce((sum, [, v]) => sum + v, 0);
    const monthCatData = monthTopCats.map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
    if (monthOther > 0) monthCatData.push({ label: "Andere", value: monthOther, color: "#a3a3a3" });

    const vatData = Array.from(taxByRate.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([rate, value], i) => ({
        label: `MwSt ${rate}%`,
        value,
        color: palette[i % palette.length]
      }));

    const recurringBySupplier = Array.from(
      invoices.reduce((map, inv) => {
        const key = inv.lieferant || "Unbekannt";
        const prev = map.get(key) ?? { count: 0, total: 0 };
        prev.count += 1;
        prev.total += Number(inv.brutto_betrag ?? 0);
        map.set(key, prev);
        return map;
      }, new Map<string, { count: number; total: number }>())
    );
    const recurring = recurringBySupplier.filter(([, v]) => v.count > 1).reduce((sum, [, v]) => sum + v.total, 0);
    const oneOff = recurringBySupplier.filter(([, v]) => v.count <= 1).reduce((sum, [, v]) => sum + v.total, 0);

    const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const weekdayData = weekdayTotals.map((value, i) => ({
      label: weekdayLabels[i],
      value,
      color: palette[i % palette.length]
    }));

    return [
      {
        title: "Monatlicher Cashflow",
        subtitle: "Einnahmen vs. Ausgaben",
        data: [
          { label: "Eingänge", value: incoming, color: "#2563eb" },
          { label: "Ausgänge", value: outgoing, color: "#ef4444" }
        ]
      },
      {
        title: "Kategorie-Trend (aktueller Monat)",
        subtitle: "Top-Kategorien nach Betrag",
        data: monthCatData.length > 0 ? monthCatData : [{ label: "Keine Daten", value: 1, color: "#cbd5e1" }]
      },
      {
        title: "Tedarikçi Konsantrasyonu",
        subtitle: "Top 5 + Andere",
        data: topSupplierData.length > 0 ? topSupplierData : [{ label: "Keine Daten", value: 1, color: "#cbd5e1" }]
      },
      {
        title: "MwSt Verteilung",
        subtitle: "Steuerbetrag nach Steuersatz",
        data: vatData.length > 0 ? vatData : [{ label: "Keine Daten", value: 1, color: "#cbd5e1" }]
      },
      {
        title: "Fälligkeit Status",
        subtitle: "Überfällig / 7 Tage / Offen",
        data: [
          { label: "Überfällig", value: overdue, color: "#ef4444" },
          { label: "Nächste 7 Tage", value: next7Days, color: "#f59e0b" },
          { label: "Ohne Fälligkeitsdatum", value: noDue, color: "#64748b" }
        ]
      },
      {
        title: "Belge Kalite Dağılımı",
        subtitle: "OCR/AI Qualität",
        data: [
          { label: "Yüksek", value: qualityHigh, color: "#10b981" },
          { label: "Orta", value: qualityMid, color: "#2563eb" },
          { label: "Düşük", value: qualityLow, color: "#ef4444" },
          { label: "Yok", value: qualityMissing, color: "#6b7280" }
        ]
      },
      {
        title: "Düzenli vs Tek Sefer",
        subtitle: "Lieferant bazlı tekrar",
        data: [
          { label: "Düzenli", value: recurring, color: "#111827" },
          { label: "Tek Sefer", value: oneOff, color: "#2563eb" }
        ]
      },
      {
        title: "Haftalık Harcama",
        subtitle: "Haftanın günlerine göre",
        data: weekdayData.some((d) => d.value > 0) ? weekdayData : [{ label: "Keine Daten", value: 1, color: "#cbd5e1" }]
      }
    ];
  }, [invoices, stats]);

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

        <div className="pie-slider-block">
          <div className="pie-slider-head">
            <div>
              <h4>{pieSlides[activePieSlide]?.title}</h4>
              <p>{pieSlides[activePieSlide]?.subtitle}</p>
            </div>
            <div className="pie-slider-controls">
              <button
                type="button"
                onClick={() => setActivePieSlide((prev) => (prev === 0 ? pieSlides.length - 1 : prev - 1))}
                aria-label="Vorherige Statistik"
              >
                ←
              </button>
              <span>
                {activePieSlide + 1}/{pieSlides.length}
              </span>
              <button
                type="button"
                onClick={() => setActivePieSlide((prev) => (prev === pieSlides.length - 1 ? 0 : prev + 1))}
                aria-label="Nächste Statistik"
              >
                →
              </button>
            </div>
          </div>
          <div className="pie-slider-content">
            <div className="pie-slider-chart">
              <PieChart data={pieSlides[activePieSlide]?.data ?? []} radius={92} innerRadius={54} />
            </div>
            <div className="pie-slider-legend">
              {(pieSlides[activePieSlide]?.data ?? []).map((item) => (
                <div key={`${pieSlides[activePieSlide]?.title}-${item.label}`} className="pie-legend-row">
                  <span className="pie-legend-dot" style={{ background: item.color }} />
                  <span className="pie-legend-label">{item.label}</span>
                  <strong className="pie-legend-value">
                    {item.value.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                  </strong>
                </div>
              ))}
            </div>
          </div>
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
                strokeDashoffset={175.9 - (175.9 * averageQualityScore) / 10}
              />
            </svg>
            <span className="gauge-center-label">{Math.round(averageQualityScore * 10)}%</span>
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
