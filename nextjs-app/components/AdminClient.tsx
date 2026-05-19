"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { Category } from "@/lib/types";

type AiOption = {
  label: string;
  provider: string;
  model: string;
};

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
  const [aiOptions, setAiOptions] = useState<Record<string, AiOption>>({});
  const [aiService, setAiService] = useState("openrouter_openai");
  const [aiKey, setAiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("Nicht gesetzt");

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [newCategory, setNewCategory] = useState({ name: "", beschreibung: "", farbe: "#6366F1" });
  const [budgetCategoryId, setBudgetCategoryId] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [debugToolsOpen, setDebugToolsOpen] = useState(false);
  const [debugMonitorEnabled, setDebugMonitorEnabled] = useState(true);

  async function loadAll(): Promise<void> {
    const [catRes, aiRes, statsRes] = await Promise.all([
      fetch("/api/categories", { cache: "no-store" }),
      fetch("/api/settings/ai", { cache: "no-store" }),
      fetch("/api/stats", { cache: "no-store" })
    ]);

    const catData = (await catRes.json()) as { categories?: Category[] };
    const aiData = (await aiRes.json()) as {
      settings?: { ai_service?: string; masked_api_key?: string };
      options?: Record<string, AiOption>;
    };
    const statsData = (await statsRes.json()) as {
      stats?: StatsPayload;
      insights?: string[];
    };

    setCategories(Array.isArray(catData.categories) ? catData.categories : []);
    setAiOptions(aiData.options ?? {});
    setAiService(aiData.settings?.ai_service ?? "openrouter_openai");
    setMaskedKey(aiData.settings?.masked_api_key ?? "Nicht gesetzt");
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
      setStatus({ ok: false, text: data.message ?? "Kategorie konnte nicht erstellt werden." });
      return;
    }
    setStatus({ ok: true, text: "Kategorie wurde erstellt." });
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
    setStatus({ ok: Boolean(data.ok), text: data.message ?? "Kategorie wurde deaktiviert." });
    await loadAll();
  }

  async function removeCategory(categoryId: number): Promise<void> {
    if (!confirm("Kategorie wirklich löschen?")) {
      return;
    }

    const res = await fetch(`/api/categories/${categoryId}`, { method: "DELETE" });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    setStatus({ ok: Boolean(data.ok), text: data.message ?? "Kategorie gelöscht." });
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
    setStatus({ ok: Boolean(data.ok), text: data.message ?? "Budget gespeichert." });
    await loadAll();
  }

  async function saveAi(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const res = await fetch("/api/settings/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: aiService, apiKey: aiKey })
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      settings?: { masked_api_key?: string };
    };

    setStatus({ ok: Boolean(data.ok), text: data.message ?? "AI-Einstellungen gespeichert." });
    setMaskedKey(data.settings?.masked_api_key ?? maskedKey);
    setAiKey("");
    await loadAll();
  }

  return (
    <div className="page-admin">
      {status ? (
        <div className="popup-overlay" id="statusPopup">
          <div className="popup-card">
            <h3>{status.ok ? "Erfolg" : "Warnung"}</h3>
            <p>{status.text}</p>
            <button type="button" className="btn btn-primary" onClick={() => setStatus(null)}>
              OK
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-card">
            <h3>Kategorien verwalten</h3>
            <form className="kat-form" onSubmit={(event) => void createCategory(event)}>
              <div className="form-group">
                <label>Kategoriename</label>
                <input
                  value={newCategory.name}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label>Beschreibung</label>
                <input
                  value={newCategory.beschreibung}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, beschreibung: event.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Farbe</label>
                <input
                  type="color"
                  className="color-picker"
                  value={newCategory.farbe}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, farbe: event.target.value }))}
                />
              </div>
              <button className="btn btn-primary btn-full" type="submit">
                + Neue Kategorie
              </button>
            </form>

            <form className="kat-form" onSubmit={(event) => void saveBudget(event)}>
              <div className="form-group">
                <label>Kategorie Budget</label>
                <select value={budgetCategoryId} onChange={(event) => setBudgetCategoryId(event.target.value)} required>
                  <option value="">Bitte wählen</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Monatsbudget (EUR)</label>
                <input value={budgetAmount} onChange={(event) => setBudgetAmount(event.target.value)} required />
              </div>
              <button className="btn btn-outline btn-full" type="submit">
                Budget speichern
              </button>
            </form>

            <div className="kat-liste">
              {categories.map((cat) => (
                <div className="kat-item" key={cat.id}>
                  <span className="kat-farbe" style={{ background: cat.farbe }} />
                  <span className="kat-name">{cat.name}</span>
                  <button className="btn-icon" type="button" title="Deaktivieren" onClick={() => void deactivateCategory(cat.id)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                  </button>
                  <button className="btn-icon btn-loeschen" type="button" title="Löschen" onClick={() => void removeCategory(cat.id)}>
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
                {debugToolsOpen ? "Debug Araçlarını Kapat" : "Debug Araçlarını Aç"}
              </button>
              {debugToolsOpen ? (
                <div className="admin-debug-tools-panel">
                  <div className="debug-switch-wrap admin-switch-row">
                    <span className="debug-switch-label">Dashboard Debug Monitor</span>
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
                    Input Sayfasına Git
                  </a>
                  <Link className="btn btn-outline btn-full" href="/debug-json">
                    JSON Debug Sayfası
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
                <div className="stats-label">Höchste Ausgabenphase</div>
                <div className="stats-value">{stats.top.zeitraum || "-"}</div>
                <div className="stats-sub">Monat mit maximaler Summe</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">Top-Kategorie</div>
                <div className="stats-value">{stats.top.kategorie || "-"}</div>
                <div className="stats-sub">Nach Betrag</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">Häufigster Lieferant</div>
                <div className="stats-value">{stats.top.lieferant || "-"}</div>
                <div className="stats-sub">Nach Rechnungsanzahl</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">Gesamtüberblick</div>
                <div className="stats-value">{stats.totals.gesamt_anzahl} Rechnungen</div>
                <div className="stats-sub">{stats.totals.gesamt_summe.toFixed(2)} EUR gesamt</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">Ø Rechnungsbetrag</div>
                <div className="stats-value">{stats.totals.avg_betrag.toFixed(2)} EUR</div>
                <div className="stats-sub">Durchschnitt pro Rechnung</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">Netto-Cashflow</div>
                <div className={`stats-value ${stats.totals.netto_cashflow >= 0 ? "up" : "down"}`}>
                  {stats.totals.netto_cashflow.toFixed(2)} EUR
                </div>
                <div className="stats-sub">Ausgang - Eingang</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">30-Tage Trend</div>
                <div className={`stats-value ${stats.trend30 <= 0 ? "up" : "down"}`}>{stats.trend30.toFixed(2)}%</div>
                <div className="stats-sub">gegenüber vorherigen 30 Tagen</div>
              </div>
              <div className="stats-card">
                <div className="stats-label">Überfällige Rechnungen</div>
                <div className="stats-value down">{stats.alerts.offene_ueberfaellig}</div>
                <div className="stats-sub">Fälligkeit überschritten</div>
              </div>
            </div>
          ) : null}

          <div className="admin-card ai-card">
            <h3>AI Einstellungen</h3>
            <div className="api-key-hint">Aktuell: {maskedKey}</div>
            <form className="kat-form" onSubmit={(event) => void saveAi(event)}>
              <div className="form-group">
                <label>AI Service</label>
                <select value={aiService} onChange={(event) => setAiService(event.target.value)}>
                  {Object.entries(aiOptions).map(([key, option]) => (
                    <option key={key} value={key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>API-Key</label>
                <input
                  type="password"
                  value={aiKey}
                  onChange={(event) => setAiKey(event.target.value)}
                  placeholder="sk-... / sk-or-v1-..."
                />
              </div>
              <button className="btn btn-outline" type="submit">
                API-Einstellungen speichern
              </button>
            </form>
          </div>

          <div className="admin-card ai-card">
            <h3>Budget Überblick</h3>
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
              <div className="stats-sub">Noch keine Budgets gesetzt.</div>
            )}
          </div>

          <div className="admin-card ai-card">
            <h3>KI-Empfehlungen</h3>
            <div className="ai-meta">Quelle: KI/FALLBACK</div>
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
