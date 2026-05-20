/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, Invoice } from "@/lib/types";
import { t, txt } from "@/lang";

type EditState = {
  lieferant: string;
  kategorie_id: string;
  rechnung_typ: "eingang" | "ausgang";
  rechnungsdatum: string;
  faelligkeitsdatum: string;
  netto_betrag: string;
  mwst_satz: string;
  mwst_betrag: string;
  brutto_betrag: string;
  waehrung: string;
  beschreibung: string;
};

type Zeitraum = "all" | "week" | "month" | "quarter" | "year";
type LimitValue = 5 | 10 | 20 | 50 | 100 | "all";
type DescriptionInfo = {
  supplier: string;
  address: string;
  taxId: string;
};

const emptyEdit: EditState = {
  lieferant: "",
  kategorie_id: "",
  rechnung_typ: "eingang",
  rechnungsdatum: "",
  faelligkeitsdatum: "",
  netto_betrag: "",
  mwst_satz: "",
  mwst_betrag: "",
  brutto_betrag: "",
  waehrung: "EUR",
  beschreibung: ""
};

function toEdit(invoice: Invoice): EditState {
  return {
    lieferant: invoice.lieferant ?? "",
    kategorie_id: invoice.kategorie_id ? String(invoice.kategorie_id) : "",
    rechnung_typ: invoice.rechnung_typ,
    rechnungsdatum: invoice.rechnungsdatum ?? "",
    faelligkeitsdatum: invoice.faelligkeitsdatum ?? "",
    netto_betrag: invoice.netto_betrag == null ? "" : String(invoice.netto_betrag),
    mwst_satz: invoice.mwst_satz ?? "",
    mwst_betrag: invoice.mwst_betrag == null ? "" : String(invoice.mwst_betrag),
    brutto_betrag: invoice.brutto_betrag == null ? "" : String(invoice.brutto_betrag),
    waehrung: invoice.waehrung ?? "EUR",
    beschreibung: invoice.beschreibung ?? ""
  };
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]) - 1;
    const d = Number(dateOnly[3]);
    return new Date(y, m, d);
  }

  return null;
}

function formatDate(date: Date | null): string {
  if (!date) return "-";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function formatDateTime(date: Date | null): string {
  if (!date) return "-";
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(date)} ${hh}:${mi}`;
}

function formatAmount(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${decPart}`;
}

function extractLabeledValue(text: string, labels: string[]): string {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stop =
    "(?:Lieferant|Firma|Adres|Adresse|Tarih|Datum|Saat|Uhrzeit|Toplam|Betrag|Odem[eé]|Ödeme|Karten-Nr|T-ID|Beleg-Nr|VU-Nummer|USt-IdNr|Steuernummer|Steuer-Nr|Vergi kırılımı|Kontrol|$)";
  const match = text.match(new RegExp(`(?:^|\\n|\\s)(?:${escaped})\\s*:\\s*(.*?)(?=\\n|\\s${stop}\\s*:|$)`, "i"));
  return match ? match[1].trim() : "";
}

function extractDescriptionInfo(description: string | null | undefined, fallbackSupplier: string | null | undefined): DescriptionInfo {
  const text = String(description || "").replace(/\r/g, "\n").trim();
  const compact = text.replace(/\s+/g, " ").trim();
  return {
    supplier: extractLabeledValue(text, ["Lieferant", "Firma"]) || String(fallbackSupplier || "").trim(),
    address: extractLabeledValue(text, ["Adres", "Adresse"]),
    taxId: extractLabeledValue(text, ["USt-IdNr", "Steuernummer", "Steuer-Nr", "Vergi No"]) || extractLabeledValue(compact, ["USt-IdNr", "Steuernummer", "Steuer-Nr", "Vergi No"])
  };
}

function DescriptionSummary({
  description,
  fallbackSupplier,
  compact = false
}: {
  description: string | null | undefined;
  fallbackSupplier: string | null | undefined;
  compact?: boolean;
}) {
  const info = extractDescriptionInfo(description, fallbackSupplier);
  if (!info.supplier && !info.address && !info.taxId) return null;

  return (
    <span className={compact ? "description-inline" : "description-summary"}>
      {info.supplier ? <strong>{info.supplier}</strong> : null}
      {info.address ? <span>{info.address}</span> : null}
      {info.taxId ? <span>{t.user.vatId}: {info.taxId.replace(/^USt-IdNr\s*:\s*/i, "")}</span> : null}
    </span>
  );
}

function extractTaxLines(
  beschreibung: string,
  mwstSatz: string,
  mwstBetrag: string
): Array<{ rate: string; netto: string; tax: string }> {
  const lines: Array<{ rate: string; netto: string; tax: string }> = [];
  
  // 1. Line-by-line precise matching to keep multiline formats correctly aligned
  const rawLines = String(beschreibung || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const linePattern = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*.*?netto\s*[:=]?\s*([0-9]+(?:[.,][0-9]{1,2})?).*?(?:mwst|ust|vat|steuer)\s*[:=]?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i;

  for (const line of rawLines) {
    const match = line.match(linePattern);
    if (match) {
      lines.push({
        rate: match[1].replace(".", ","),
        netto: match[2].replace(".", ","),
        tax: match[3].replace(".", ",")
      });
    }
  }

  // 2. Original fallback for flattened/single-line descriptions
  if (lines.length === 0) {
    const text = String(beschreibung || "").replace(/\s+/g, " ").trim();
    const fullPattern =
      /(\d{1,2}(?:[.,]\d{1,2})?)\s*%.*?netto\s*[:=]?\s*([0-9]+(?:[.,][0-9]{1,2})?).*?(?:mwst|ust|vat|steuer)\s*[:=]?\s*([0-9]+(?:[.,][0-9]{1,2})?)(?=\s*\d{1,2}(?:[.,]\d{1,2})?\s*%|$)/gi;
    let fullMatch: RegExpExecArray | null = fullPattern.exec(text);
    while (fullMatch) {
      lines.push({
        rate: fullMatch[1].replace(".", ","),
        netto: fullMatch[2].replace(".", ","),
        tax: fullMatch[3].replace(".", ",")
      });
      fullMatch = fullPattern.exec(text);
    }
  }

  // 3. Fallback to simple percentage matches if still empty
  if (lines.length === 0) {
    const parts = String(beschreibung || "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    for (const p of parts) {
      const fallback = p.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
      if (fallback) {
        lines.push({
          rate: fallback[1].replace(".", ","),
          netto: "",
          tax: fallback[2].replace(".", ",")
        });
      }
    }
  }

  // 4. Default primary values fallback
  if (lines.length === 0 && (mwstSatz || mwstBetrag)) {
    lines.push({
      rate: String(mwstSatz || "").replace(".", ","),
      netto: "",
      tax: String(mwstBetrag || "").replace(".", ",")
    });
  }
  return lines;
}

function getIsoWeek(date: Date): number {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = (utcDate.getUTCDay() + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 4));
  const diff = utcDate.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / 604800000);
}

function groupLabel(zeitraum: Zeitraum, date: Date): string {
  if (zeitraum === "all") return t.invoices.allInvoices;
  if (zeitraum === "week") return `KW ${String(getIsoWeek(date)).padStart(2, "0")} / ${date.getFullYear()}`;
  if (zeitraum === "month") return `${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
  if (zeitraum === "quarter") return `Q${Math.ceil((date.getMonth() + 1) / 3)} / ${date.getFullYear()}`;
  return String(date.getFullYear());
}

function baseDate(invoice: Invoice): Date {
  return parseDate(invoice.rechnungsdatum) ?? parseDate(invoice.hochladezeit) ?? new Date(0);
}

export function InvoicesClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [zeitraum, setZeitraum] = useState<Zeitraum>("month");
  const [typ, setTyp] = useState<"eingang" | "ausgang">("eingang");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState<LimitValue>(20);
  const [page, setPage] = useState(1);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>(emptyEdit);

  const [preview, setPreview] = useState<{ file: string; type: string } | null>(null);
  const closePreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editZoom, setEditZoom] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{ id: number; text: string } | null>(null);

  const loadCategories = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/categories?activeOnly=1", { cache: "no-store" });
    const data = (await res.json()) as { categories?: Category[] };
    setCategories(Array.isArray(data.categories) ? data.categories : []);
  }, []);

  const loadInvoices = useCallback(async (): Promise<void> => {
    setLoading(true);
    const res = await fetch("/api/invoices", { cache: "no-store" });
    const data = (await res.json()) as { invoices?: Invoice[] };
    setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCategories();
    void loadInvoices();
  }, [loadCategories, loadInvoices]);

  useEffect(() => {
    return () => {
      if (closePreviewTimer.current) {
        clearTimeout(closePreviewTimer.current);
      }
    };
  }, []);

  const filteredSorted = useMemo(() => {
    const out = invoices
      .filter((invoice) => invoice.rechnung_typ === typ)
      .filter((invoice) => (category ? String(invoice.kategorie_name ?? "") === category : true))
      .sort((a, b) => baseDate(b).getTime() - baseDate(a).getTime());
    return out;
  }, [invoices, typ, category]);

  const totalInvoices = filteredSorted.length;
  const totalPages = limit === "all" ? 1 : Math.max(1, Math.ceil(totalInvoices / limit));
  const currentPage = Math.min(page, totalPages);

  const pagedInvoices = useMemo(() => {
    if (limit === "all") return filteredSorted;
    const start = (currentPage - 1) * limit;
    return filteredSorted.slice(start, start + limit);
  }, [filteredSorted, limit, currentPage]);

  const grouped = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const invoice of pagedInvoices) {
      const key = groupLabel(zeitraum, baseDate(invoice));
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(invoice);
    }
    return Array.from(map.entries());
  }, [pagedInvoices, zeitraum]);

  const editingInvoice = useMemo(() => invoices.find((invoice) => invoice.id === editingId) ?? null, [invoices, editingId]);
  const taxLines = useMemo(
    () => extractTaxLines(editState.beschreibung, editState.mwst_satz, editState.mwst_betrag),
    [editState.beschreibung, editState.mwst_satz, editState.mwst_betrag]
  );

  function openEdit(invoice: Invoice): void {
    setEditingId(invoice.id);
    setEditState(toEdit(invoice));
    setEditZoom(false);
    setStatus(null);
  }

  function openPreview(file: string, type: string): void {
    if (closePreviewTimer.current) {
      clearTimeout(closePreviewTimer.current);
      closePreviewTimer.current = null;
    }
    setPreview({ file, type });
  }

  function cancelPreviewClose(): void {
    if (closePreviewTimer.current) {
      clearTimeout(closePreviewTimer.current);
      closePreviewTimer.current = null;
    }
  }

  function scheduleClosePreview(): void {
    if (closePreviewTimer.current) {
      clearTimeout(closePreviewTimer.current);
    }
    closePreviewTimer.current = setTimeout(() => {
      setPreview(null);
    }, 120);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editingId) return;

    const payload = {
      ...editState,
      kategorie_id: editState.kategorie_id ? Number(editState.kategorie_id) : null,
      netto_betrag: editState.netto_betrag ? Number(editState.netto_betrag) : null,
      mwst_betrag: editState.mwst_betrag ? Number(editState.mwst_betrag) : null,
      brutto_betrag: editState.brutto_betrag ? Number(editState.brutto_betrag) : null
    };

    const res = await fetch(`/api/invoices/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data.ok) {
      setStatus({ type: "error", text: data.message ?? t.invoices.updateFailed });
      return;
    }

    setStatus({ type: "ok", text: t.invoices.saved });
    await loadInvoices();
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteModal) return;
    const deleteId = deleteModal.id;
    setDeleteModal(null);

    const res = await fetch(`/api/invoices/${deleteId}`, { method: "DELETE" });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data.ok) {
      setStatus({ type: "error", text: data.message ?? t.invoices.deleteFailed });
      return;
    }

    if (editingId === deleteId) {
      setEditingId(null);
      setEditState(emptyEdit);
    }

    setStatus({ type: "ok", text: t.invoices.deleted });
    await loadInvoices();
  }

  function openDeleteConfirm(invoice: Invoice): void {
    const name = invoice.lieferant || t.common.unknown;
    const amount = formatAmount(invoice.brutto_betrag ?? 0);
    const currency = invoice.waehrung || "EUR";
    setDeleteModal({ id: invoice.id, text: txt(t.invoices.deleteDetails, { name, amount, currency }) });
  }

  const editingInvoiceFileUrl = editingInvoice ? `/api/uploads/${encodeURIComponent(editingInvoice.dateiname)}` : "";
  const editingIsPdf = editingInvoice
    ? editingInvoice.dateiname.toLowerCase().endsWith(".pdf") || editingInvoice.dateityp.toLowerCase().includes("pdf")
    : false;

  return (
    <>
      {editingInvoice ? (
        <section id="edit-panel" className="edit-panel">
          <h2>{t.invoices.editTitle}</h2>
          <p>{t.invoices.editIntro}</p>
          <div className="edit-layout">
            <div className="edit-preview">
              <div className="edit-preview-toolbar">
                <button
                  type="button"
                  className={`zoom-btn ${editZoom ? "active" : ""}`}
                  onClick={() => setEditZoom((prev) => !prev)}
                  title={editZoom ? t.invoices.zoomReset : t.invoices.zoomIn}
                  aria-label={editZoom ? t.invoices.zoomReset : t.invoices.zoomIn}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                </button>
              </div>
              <div className={`edit-doc-wrap ${editZoom ? "zoomed" : ""}`}>
                {editingIsPdf ? (
                  <object data={`${editingInvoiceFileUrl}#page=1&view=FitH`} type="application/pdf" className="edit-doc edit-doc-pdf" />
                ) : (
                  <img src={editingInvoiceFileUrl} className="edit-doc edit-doc-image" alt={t.app.name} />
                )}
              </div>
            </div>

            <form method="POST" className="edit-form" onSubmit={(event) => void submitEdit(event)}>
              <div className="edit-grid">
                <div className="form-group">
                  <label>{t.invoices.supplier}</label>
                  <input value={editState.lieferant} onChange={(event) => setEditState((prev) => ({ ...prev, lieferant: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>{t.invoices.category}</label>
                  <select value={editState.kategorie_id} onChange={(event) => setEditState((prev) => ({ ...prev, kategorie_id: event.target.value }))}>
                    <option value="0">{t.common.none}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>{t.invoices.invoiceType}</label>
                  <select value={editState.rechnung_typ} onChange={(event) => setEditState((prev) => ({ ...prev, rechnung_typ: event.target.value as "eingang" | "ausgang" }))}>
                    <option value="eingang">{t.invoices.incoming}</option>
                    <option value="ausgang">{t.invoices.outgoing}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>{t.invoices.invoiceDate}</label>
                  <input type="date" value={editState.rechnungsdatum} onChange={(event) => setEditState((prev) => ({ ...prev, rechnungsdatum: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>{t.invoices.dueDate}</label>
                  <input type="date" value={editState.faelligkeitsdatum} onChange={(event) => setEditState((prev) => ({ ...prev, faelligkeitsdatum: event.target.value }))} />
                </div>
                <div className="form-group">
                  <div className="vat-guidance">
                    <strong>{t.invoices.vatGuidanceTitle}</strong> {t.invoices.vatGuidanceText}
                  </div>
                </div>
                <div className="form-group full">
                  <div className="tax-input-grid">
                    <div className="form-group">
                      <label>{t.invoices.net}</label>
                      <input type="number" step="0.01" value={editState.netto_betrag} onChange={(event) => setEditState((prev) => ({ ...prev, netto_betrag: event.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>{t.invoices.vatRate}</label>
                      <input type="number" step="0.01" value={editState.mwst_satz} onChange={(event) => setEditState((prev) => ({ ...prev, mwst_satz: event.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>{t.invoices.vatAmount}</label>
                      <input type="number" step="0.01" value={editState.mwst_betrag} onChange={(event) => setEditState((prev) => ({ ...prev, mwst_betrag: event.target.value }))} />
                    </div>
                  </div>
                </div>
                {taxLines.length > 1
                  ? taxLines.slice(1).map((line, idx) => (
                      <div className="form-group full" key={`${line.rate}-${line.netto}-${line.tax}-${idx}-row`}>
                        <div className="tax-input-grid">
                          <div className="form-group">
                            <label>{t.invoices.net}</label>
                            <input value={line.netto} readOnly />
                          </div>
                          <div className="form-group">
                            <label>{t.invoices.vatRate}</label>
                            <input value={line.rate} readOnly />
                          </div>
                          <div className="form-group">
                            <label>{t.invoices.vatAmount}</label>
                            <input value={line.tax} readOnly />
                          </div>
                        </div>
                      </div>
                    ))
                  : null}
                <div className="form-group">
                  <label>{t.invoices.gross}</label>
                  <input type="number" step="0.01" value={editState.brutto_betrag} onChange={(event) => setEditState((prev) => ({ ...prev, brutto_betrag: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>{t.invoices.currency}</label>
                  <input value={editState.waehrung} onChange={(event) => setEditState((prev) => ({ ...prev, waehrung: event.target.value }))} />
                </div>
                <div className="form-group full">
                  <label>{t.invoices.description}</label>
                  <div className="description-summary-box">
                    <DescriptionSummary description={editState.beschreibung} fallbackSupplier={editState.lieferant} />
                  </div>
                </div>
              </div>
              <div className="edit-actions">
                <a href={editingInvoiceFileUrl} target="_blank" rel="noreferrer" className="btn btn-outline">{t.common.view}</a>
                <button type="button" className="btn btn-outline" onClick={() => openDeleteConfirm(editingInvoice)}>{t.common.delete}</button>
                <button type="submit" className="btn btn-primary">{t.common.save}</button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      <section className="rechnungen-section">
        <div className="section-header">
          <h2>{t.invoices.title}</h2>
          <div className="filter-group">
            <select
              className="filter-select"
              value={zeitraum}
              onChange={(event) => {
                setZeitraum(event.target.value as Zeitraum);
                setPage(1);
              }}
            >
              <option value="all">{t.invoices.allInvoices}</option>
              <option value="week">{t.invoices.weekly}</option>
              <option value="month">{t.invoices.monthly}</option>
              <option value="quarter">{t.invoices.quarterly}</option>
              <option value="year">{t.invoices.yearly}</option>
            </select>
          </div>
        </div>

        {status ? <div className={`alert ${status.type === "ok" ? "alert-success" : "alert-error"}`}>{status.text}</div> : null}

        <div className="rechnungen-layout">
          <aside className="rechnungen-sidebar">
            <h3>{t.invoices.typeHeading}</h3>
            <div className="type-buttons">
              <button className={`type-btn ${typ === "eingang" ? "active" : ""}`} type="button" onClick={() => { setTyp("eingang"); setPage(1); }}>
                {t.invoices.incomingInvoices}
              </button>
              <button className={`type-btn ${typ === "ausgang" ? "active" : ""}`} type="button" onClick={() => { setTyp("ausgang"); setPage(1); }}>
                {t.invoices.outgoingInvoices}
              </button>
            </div>
            <h3>{t.invoices.categories}</h3>
            <div className="category-list">
              <button className={`category-item ${category === "" ? "active" : ""}`} type="button" onClick={() => { setCategory(""); setPage(1); }}>
                <span className="cat-color cat-color-all" />
                <span className="cat-label">{t.invoices.allCategories}</span>
              </button>
              {categories.map((cat) => (
                <button key={cat.id} className={`category-item ${category === cat.name ? "active" : ""}`} type="button" onClick={() => { setCategory(cat.name); setPage(1); }}>
                  <span className="cat-color" style={{ background: cat.farbe || "#95A5A6" }} />
                  <span className="cat-label">{cat.name}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="rechnungen-content">
            <h3 className="split-title">{typ === "ausgang" ? t.invoices.outgoingInvoices : t.invoices.incomingInvoices}</h3>

            {loading ? <p className="empty-note">{t.common.loading}</p> : null}
            {!loading && filteredSorted.length === 0 ? <p className="empty-note">{t.invoices.emptyFilter}</p> : null}

            {!loading && filteredSorted.length > 0
              ? grouped.map(([groupName, groupInvoices]) => (
                  <div key={groupName}>
                    {groupName !== t.invoices.allInvoices ? <h4 className="group-title">{groupName}</h4> : null}
                    <div className="rechnungen-grid">
                      {groupInvoices.map((invoice) => {
                        const safeName = invoice.dateiname;
                        const fileUrl = `/api/uploads/${encodeURIComponent(safeName)}`;
                        const isPdf = safeName.toLowerCase().endsWith(".pdf") || invoice.dateityp.toLowerCase().includes("pdf");
                        const rechnungsdatumLabel = formatDate(parseDate(invoice.rechnungsdatum));
                        const eingangsdatumLabel = formatDateTime(parseDate(invoice.hochladezeit));
                        return (
                          <div className="rechnung-row" data-kategorie={invoice.kategorie_name ?? ""} key={invoice.id}>
                            <button
                              type="button"
                              className="thumb-btn"
                              data-file={fileUrl}
                              data-type={invoice.dateityp}
                              title={t.invoices.previewOpen}
                              onMouseEnter={() => openPreview(fileUrl, invoice.dateityp)}
                              onMouseLeave={() => scheduleClosePreview()}
                              onFocus={() => openPreview(fileUrl, invoice.dateityp)}
                              onBlur={() => scheduleClosePreview()}
                            >
                              {isPdf ? (
                                <object data={`${fileUrl}#page=1&view=FitH`} type="application/pdf" className="rechnung-thumb pdf-thumb">
                                  <span className="thumb-pdf">{t.common.pdf}</span>
                                </object>
                              ) : (
                                <img src={fileUrl} className="rechnung-thumb" alt={t.app.name} />
                              )}
                            </button>
                            <div className="row-main">
                              <div className="row-main-top">
                                <span className="rechnung-badge" style={{ background: invoice.farbe || "#95A5A6" }}>
                                  {invoice.kategorie_name || t.dashboard.uncategorized}
                                </span>
                                <DescriptionSummary description={invoice.beschreibung} fallbackSupplier={invoice.lieferant} compact />
                              </div>
                              <div className="row-main-bottom">
                                <span className="row-meta">{t.invoices.invoiceDateLabel}: {rechnungsdatumLabel}</span>
                                <span className="row-meta">{t.invoices.receivedDateLabel}: {eingangsdatumLabel}</span>
                              </div>
                            </div>
                            <div className="row-actions">
                              <div className="row-actions-amount">{formatAmount(invoice.brutto_betrag)} {invoice.waehrung || "EUR"}</div>
                              <div className="row-actions-meta">{t.invoices.vatShort}: {String(invoice.mwst_satz ?? "0")}% {t.invoices.net}: {formatAmount(invoice.netto_betrag)}</div>
                              <div className="row-actions-icons">
                                <a href={fileUrl} target="_blank" rel="noreferrer" className="action-square action-view" title={t.common.view} aria-label={t.common.view}>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                </a>
                                <button type="button" className="action-square action-edit" title={t.common.edit} aria-label={t.common.edit} onClick={() => openEdit(invoice)}>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
                                  </svg>
                                </button>
                                <button type="button" className="action-square action-delete" title={t.common.delete} aria-label={t.common.delete} onClick={() => openDeleteConfirm(invoice)}>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3,6 5,6 21,6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              : null}

            {totalInvoices > 0 ? (
              <div className="pagination-footer">
                <div className="pagination-limit">
                  <label htmlFor="limitSelect">{t.invoices.perPage}</label>
                  <select
                    id="limitSelect"
                    className="filter-select"
                    value={String(limit)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const next = raw === "all" ? "all" : (Number(raw) as LimitValue);
                      setLimit(next);
                      setPage(1);
                    }}
                  >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="all">{t.common.all}</option>
                  </select>
                </div>
                {limit !== "all" && totalPages > 1 ? (
                  <div className="pagination-pages">
                    {currentPage > 1 ? (
                      <button className="page-link" type="button" onClick={() => setPage(currentPage - 1)}>
                        &laquo;
                      </button>
                    ) : null}
                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((i) => (
                      <button key={i} className={`page-link ${i === currentPage ? "active" : ""}`} type="button" onClick={() => setPage(i)}>
                        {i}
                      </button>
                    ))}
                    {currentPage < totalPages ? (
                      <button className="page-link" type="button" onClick={() => setPage(currentPage + 1)}>
                        &raquo;
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div id="previewModal" className="preview-modal" hidden={!preview}>
        <div className="preview-backdrop" data-close="1" onClick={() => setPreview(null)} />
        <div className="preview-content" onMouseEnter={() => cancelPreviewClose()} onMouseLeave={() => scheduleClosePreview()}>
          <button type="button" className="preview-close" data-close="1" title={t.common.close} onClick={() => setPreview(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div id="previewBody" className="preview-body">
            {preview ? (
              preview.type.toLowerCase().includes("pdf") ? (
                <iframe src={`${preview.file}#page=1&zoom=page-width`} className="preview-doc preview-pdf" loading="eager" />
              ) : (
                <img src={preview.file} alt={t.app.name} className="preview-doc" />
              )
            ) : null}
          </div>
        </div>
      </div>

      <div id="deleteConfirmModal" className="preview-modal" hidden={!deleteModal}>
        <div className="preview-backdrop" onClick={() => setDeleteModal(null)} />
        <div className="preview-content delete-popup">
          <h3>{t.invoices.deleteTitle}</h3>
          <p>{t.invoices.deleteQuestion}</p>
          <p id="deleteConfirmDetails" className="delete-details">{deleteModal?.text ?? ""}</p>
          <div className="edit-actions">
            <button type="button" className="btn btn-outline" id="deleteCancelBtn" onClick={() => setDeleteModal(null)}>
              {t.common.cancel}
            </button>
            <button type="button" className="btn btn-primary" id="deleteConfirmBtn" onClick={() => void confirmDelete()}>
              {t.common.delete}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
