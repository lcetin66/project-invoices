"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { Category } from "@/lib/types";
import { t, txt } from "@/lang";

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
  budgetAlerts: Array<{
    id: number;
    name: string;
    farbe: string;
    monatsbudget: number;
    ausgegeben: number;
  }>;
};

export function AdminClient() {
  const [categories, setCategories] = useState<Category[]>([]);

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [newCategory, setNewCategory] = useState({ name: "", beschreibung: "", farbe: "#6366F1" });
  const [budgetCategoryId, setBudgetCategoryId] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [debugToolsOpen, setDebugToolsOpen] = useState(false);
  const [debugMonitorEnabled, setDebugMonitorEnabled] = useState(true);

  async function loadAll(): Promise<void> {
    const [catRes, statsRes] = await Promise.all([
      fetch("/api/categories", { cache: "no-store" }),
      fetch("/api/stats", { cache: "no-store" })
    ]);

    const catData = (await catRes.json()) as { categories?: Category[] };
    const statsData = (await statsRes.json()) as {
      stats?: StatsPayload;
      insights?: string[];
    };

    setCategories(Array.isArray(catData.categories) ? catData.categories : []);
    setStats(statsData.stats ?? null);
    setInsights(Array.isArray(statsData.insights) ? statsData.insights : []);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("debug_monitor_enabled");
      if (raw == null) return;
      setDebugMonitorEnabled(raw === "1");
    } catch {
      // ignore storage errors
    }
  }, []);

  function toggleDebugMonitor(): void {
    setDebugMonitorEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("debug_monitor_enabled", next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  async function createCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCategory)
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data.ok) {
      setStatus({ ok: false, text: data.message ?? t.admin.createFailed });
      return;
    }
    setStatus({ ok: true, text: t.admin.created });
    setNewCategory({ name: "", beschreibung: "", farbe: "#6366F1" });
    await loadAll();
  }

  async function deactivateCategory(categoryId: number): Promise<void> {
    const res = await fetch(`/api/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deactivate" })
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    setStatus({ ok: Boolean(data.ok), text: data.message ?? t.admin.deactivated });
    await loadAll();
  }

  async function removeCategory(categoryId: number): Promise<void> {
    if (!confirm(t.invoices.deleteConfirm)) {
      return;
    }

    const res = await fetch(`/api/categories/${categoryId}`, { method: "DELETE" });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    setStatus({ ok: Boolean(data.ok), text: data.message ?? t.admin.deleted });
    await loadAll();
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const categoryId = Number(budgetCategoryId);
    const monthlyBudget = Number(budgetAmount);

    const res = await fetch("/api/categories/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, monthlyBudget })
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    setStatus({ ok: Boolean(data.ok), text: data.message ?? t.admin.budgetSaved });
    await loadAll();
  }

  return (
    <div className="page-admin">
      {status ? (
        <div className="popup-overlay" id="statusPopup">
          <div className="popup-card">
            <h3>{status.ok ? t.common.success : t.common.warning}</h3>
            <p>{status.text}</p>
            <button type="button" className="btn btn-primary" onClick={() => setStatus(null)}>
              {t.common.ok}
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-card">
            <h3>{t.admin.categoryManage}</h3>
            <form className="kat-form" onSubmit={(event) => void createCategory(event)}>
              <div className="form-group">
                <label>{t.admin.categoryName}</label>
                <input
                  value={newCategory.name}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t.admin.description}</label>
                <input
                  value={newCategory.beschreibung}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, beschreibung: event.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>{t.admin.color}</label>
                <input
                  type="color"
                  className="color-picker"
                  value={newCategory.farbe}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, farbe: event.target.value }))}
                />
              </div>
              <button className="btn btn-primary btn-full" type="submit">
                {t.admin.newCategory}
              </button>
            </form>

            <form className="kat-form" onSubmit={(event) => void saveBudget(event)}>
              <div className="form-group">
                <label>{t.admin.categoryBudget}</label>
                <select value={budgetCategoryId} onChange={(event) => setBudgetCategoryId(event.target.value)} required>
                  <option value="">{t.common.choose}</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t.admin.monthlyBudget}</label>
                <input value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} required />
              </div>
              <button className="btn btn-outline btn-full" type="submit">
                {t.admin.saveBudget}
              </button>
            </form>

            <div className="kat-liste">
              {categories.map((cat) => (
                <div className="kat-item" key={cat.id}>
                  <span className="kat-farbe" style={{ background: cat.farbe }} />
                  <span className="kat-name">{cat.name}</span>
                  <button className="btn-icon" type="button" title={t.admin.deactivate} onClick={() => void deactivateCategory(cat.id)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                  </button>
                  <button className="btn-icon btn-loeschen" type="button" title={t.admin.delete} onClick={() => void removeCategory(cat.id)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6m3 0V4a1 1 0 011-1h6a1 1 0 011 1v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <div className="admin-debug-tools">
              <button type="button" className="btn btn-outline btn-full" onClick={() => setDebugToolsOpen((prev) => !prev)}>
                {debugToolsOpen ? t.admin.debugToolsClose : t.admin.debugToolsOpen}
              </button>
              {debugToolsOpen ? (
                <div className="admin-debug-tools-panel">
                  <div className="debug-switch-wrap admin-switch-row">
                    <span className="debug-switch-label">{t.admin.dashboardDebug}</span>
                    <button
                      type="button"
                      className={`debug-switch ${debugMonitorEnabled ? "on" : "off"}`}
                      aria-pressed={debugMonitorEnabled}
                      onClick={toggleDebugMonitor}
                    >
                      <span className="debug-switch-knob" />
                    </button>
                  </div>
                  <a className="btn btn-primary btn-full" href="/dashboard#debug" target="_self" rel="noreferrer">
                    {t.admin.goInput}
                  </a>
                  <Link className="btn btn-outline btn-full" href="/debug-json">
                    {t.admin.goJsonDebug}
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="admin-main">
          {stats ? (
            <div className="stats-grid">
              <div className="stats-card">
                <div className="stats-label">{t.admin.highestSpendPhase}</div>
                <div className="stats-value">{stats.top.zeitraum || "-"}</div>
                <div className="stats-sub">{t.admin.highestSpendSub}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.topCategory}</div>
                <div className="stats-value">{stats.top.kategorie || "-"}</div>
                <div className="stats-sub">{t.admin.topCategorySub}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.topSupplier}</div>
                <div className="stats-value">{stats.top.lieferant || "-"}</div>
                <div className="stats-sub">{t.admin.topSupplierSub}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.overview}</div>
                <div className="stats-value">{txt(t.admin.invoiceCount, { count: String(stats.totals.gesamt_anzahl) })}</div>
                <div className="stats-sub">{txt(t.admin.totalSum, { amount: stats.totals.gesamt_summe.toFixed(2) })}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.averageInvoice}</div>
                <div className="stats-value">{stats.totals.avg_betrag.toFixed(2)} EUR</div>
                <div className="stats-sub">{t.admin.averageInvoiceSub}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.netCashflow}</div>
                <div className={`stats-value ${stats.totals.netto_cashflow >= 0 ? "up" : "down"}`}>
                  {stats.totals.netto_cashflow.toFixed(2)} EUR
                </div>
                <div className="stats-sub">{t.admin.netCashflowSub}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.trend30}</div>
                <div className={`stats-value ${stats.trend30 <= 0 ? "up" : "down"}`}>{stats.trend30.toFixed(2)}%</div>
                <div className="stats-sub">{t.admin.trend30Sub}</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">{t.admin.overdue}</div>
                <div className="stats-value down">{stats.alerts.offene_ueberfaellig}</div>
                <div className="stats-sub">{t.admin.overdueSub}</div>
              </div>
            </div>
          ) : null}

          <div className="admin-card ai-card">
            <h3>{t.admin.aiSettings}</h3>
            <div className="api-key-hint">{t.admin.aiSettingsHint}</div>
            <Link className="btn btn-outline" href="/user">
              {t.admin.goUser}
            </Link>
          </div>

          <div className="admin-card ai-card">
            <h3>{t.admin.budgetOverview}</h3>
            {stats?.budgetAlerts?.length ? (
              <ul className="ai-list">
                {stats.budgetAlerts.map((item) => {
                  const usage = item.monatsbudget > 0 ? (item.ausgegeben / item.monatsbudget) * 100 : 0;
                  return (
                    <li key={item.id}>
                      <strong>{item.name}</strong>: {item.ausgegeben.toFixed(2)} / {item.monatsbudget.toFixed(2)} EUR ({usage.toFixed(1)}%)
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="stats-sub">{t.admin.noBudgets}</div>
            )}
          </div>

          <div className="admin-card ai-card">
            <h3>{t.admin.aiRecommendations}</h3>
            <div className="ai-meta">{t.admin.aiSource}</div>
            <ul className="ai-list">
              {insights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
