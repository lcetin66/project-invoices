"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { Category } from "@/lib/types";
import { t } from "@/lang";

export function AdminClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [newCategory, setNewCategory] = useState({ name: "", beschreibung: "", farbe: "#6366F1" });
  const [budgetCategoryId, setBudgetCategoryId] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [debugMonitorEnabled, setDebugMonitorEnabled] = useState(true);

  async function loadAll(): Promise<void> {
    try {
      const catRes = await fetch("/api/categories", { cache: "no-store" });
      const catData = (await catRes.json()) as { categories?: Category[] };
      setCategories(Array.isArray(catData.categories) ? catData.categories : []);
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
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

      <div className="admin-layout-distributed">
        {/* Spalte 1: Kategorie- und Budgetverwaltung */}
        <div className="admin-column">
          <div className="admin-form-card">
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
          </div>

          <div className="admin-form-card">
            <h3>Monatliches Kategorie-Budget</h3>
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
          </div>
        </div>

        {/* Spalte 2: Aktive Kategorienliste */}
        <div className="admin-column">
          <div className="admin-form-card" style={{ minHeight: "100%" }}>
            <h3>Aktive Kategorien</h3>
            <div className="admin-category-grid" style={{ marginTop: "12px" }}>
              {categories.length === 0 ? (
                <span style={{ color: "#94a3b8", fontSize: "0.88rem" }}>Noch keine Kategorie definiert.</span>
              ) : (
                categories.map((cat) => (
                  <div className="admin-category-card" key={cat.id}>
                    <div className="admin-cat-details">
                      <span className="admin-cat-color-dot" style={{ backgroundColor: cat.farbe }} />
                      <div className="admin-cat-info">
                        <span className="admin-cat-name" title={cat.name}>{cat.name}</span>
                        <span className="admin-cat-desc" title={cat.beschreibung || ""}>{cat.beschreibung || "Keine Beschreibung"}</span>
                      </div>
                    </div>
                    <div className="admin-cat-actions">
                      <button
                        className="btn-icon-round"
                        type="button"
                        title={t.admin.deactivate}
                        onClick={() => void deactivateCategory(cat.id)}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                      </button>
                      <button
                        className="btn-icon-round btn-delete"
                        type="button"
                        title={t.admin.delete}
                        onClick={() => void removeCategory(cat.id)}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6m3 0V4a1 1 0 011-1h6a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Spalte 3: KI- und Debug-Einstellungen */}
        <div className="admin-column">
          <div className="admin-form-card">
            <h3>{t.admin.aiSettings}</h3>
            <div style={{ color: "#64748b", fontSize: "0.85rem", lineHeight: "1.4", margin: "8px 0" }}>
              {t.admin.aiSettingsHint}
            </div>
            <Link className="btn btn-outline btn-full" href="/user" style={{ textAlign: "center" }}>
              {t.admin.goUser}
            </Link>
          </div>

          <div className="admin-form-card">
            <h3>System-Debug</h3>
            <div className="admin-debug-panel" style={{ marginTop: "8px" }}>
              <div className="admin-switch-row">
                <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#475569" }}>{t.admin.dashboardDebug}</span>
                <button
                  type="button"
                  className={`debug-switch ${debugMonitorEnabled ? "on" : "off"}`}
                  aria-pressed={debugMonitorEnabled}
                  onClick={toggleDebugMonitor}
                >
                  <span className="debug-switch-knob" />
                </button>
              </div>
              <a className="btn btn-primary btn-full" href="/input#debug" target="_self" rel="noreferrer" style={{ textAlign: "center" }}>
                {t.admin.goInput}
              </a>
              <Link className="btn btn-outline btn-full" href="/debug-json" style={{ textAlign: "center" }}>
                {t.admin.goJsonDebug}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
