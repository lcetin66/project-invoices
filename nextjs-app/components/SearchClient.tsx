"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Invoice } from "@/lib/types";
import { t } from "@/lang";

function formatAmount(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function ZoomOutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6" />
      <path d="M11 8v6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function ResetZoomIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M8.5 9.5h4a2 2 0 0 1 0 4h-4" />
      <path d="m10.5 7.5-2 2 2 2" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [hoverPreviewId, setHoverPreviewId] = useState<number | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [zoomLevel, setZoomLevel] = useState(100);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setInvoices([]);
      setLoading(false);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/invoices?search=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
        const data = (await res.json()) as { invoices?: Invoice[] };
        setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const resultCount = useMemo(() => invoices.length, [invoices]);

  function renderHighlightedText(text: string | null | undefined): ReactNode {
    const source = String(text ?? "");
    const q = query.trim();
    if (!q) return source;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = source.split(new RegExp(`(${escaped})`, "gi"));
    return (
      <>
        {parts.map((part, index) =>
          part.toLocaleLowerCase() === q.toLocaleLowerCase() ? (
            <mark key={`${part}-${index}`} className="search-mark">
              {part}
            </mark>
          ) : (
            <span key={`${part}-${index}`}>{part}</span>
          )
        )}
      </>
    );
  }

  function openDetails(invoice: Invoice): void {
    setSelectedInvoice(invoice);
    setZoomLevel(100);
  }

  function closeDetails(): void {
    setSelectedInvoice(null);
    setZoomLevel(100);
  }

  return (
    <section className="search-page">
      <div className="search-sticky-wrap">
        <div className="search-hero">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search.placeholder}
            aria-label={t.search.label}
            className="search-hero-input"
            autoComplete="off"
          />
        </div>
      </div>

      {selectedInvoice ? (
        <div className="search-inline-view" role="region" aria-label={t.invoices.previewOpen}>
          <div className="search-view-layout">
            <div className="edit-preview search-floating-preview">
              <div className="edit-preview-toolbar search-preview-toolbar">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setZoomLevel((z) => Math.max(80, z - 20))}
                  title={t.invoices.zoomReset}
                  aria-label="Zoom out"
                >
                  <ZoomOutIcon />
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setZoomLevel(100)}
                  title={t.invoices.zoomReset}
                  aria-label={t.invoices.zoomReset}
                >
                  <ResetZoomIcon />
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => setZoomLevel((z) => Math.min(240, z + 20))}
                  title={t.invoices.zoomIn}
                  aria-label={t.invoices.zoomIn}
                >
                  <ZoomInIcon />
                </button>
                <span className="search-zoom-value">{zoomLevel}%</span>
                <button type="button" className="search-inline-close" onClick={closeDetails} aria-label={t.common.close}>
                  x
                </button>
              </div>
              <div className="search-float-stage">
                {(selectedInvoice.dateiname || "").toLowerCase().endsWith(".pdf") || String(selectedInvoice.dateityp || "").toLowerCase().includes("pdf") ? (
                  <object
                    data={`/api/uploads/${encodeURIComponent(selectedInvoice.dateiname)}#page=1&view=FitH&zoom=${zoomLevel}`}
                    type="application/pdf"
                    className="search-float-doc search-float-pdf"
                  >
                    <span className="thumb-pdf">{t.common.pdf}</span>
                  </object>
                ) : (
                  <img
                    src={`/api/uploads/${encodeURIComponent(selectedInvoice.dateiname)}`}
                    className="search-float-doc search-float-image"
                    alt={t.invoices.previewOpen}
                    style={{ width: `${zoomLevel}%` }}
                  />
                )}
              </div>
            </div>
            <div className="search-view-details">
              <h3>{t.common.view}</h3>
              <div className="search-view-grid">
                <div><strong>{t.search.originalImageName}:</strong> {selectedInvoice.original_dateiname || "-"}</div>
                <div><strong>{t.search.savedFileName}:</strong> {selectedInvoice.dateiname || "-"}</div>
                <div><strong>{t.invoices.invoiceDateLabel}:</strong> {selectedInvoice.rechnungsdatum || "-"}</div>
                <div><strong>{t.invoices.receivedDateLabel}:</strong> {String(selectedInvoice.hochladezeit || "").slice(0, 19).replace("T", " ")}</div>
                <div><strong>{t.invoices.typeHeading}:</strong> {selectedInvoice.rechnung_typ}</div>
                <div><strong>{t.invoices.category}:</strong> {selectedInvoice.kategorie_name || t.dashboard.uncategorized}</div>
                <div><strong>{t.invoices.supplier}:</strong> {selectedInvoice.lieferant || t.common.unknown}</div>
                <div><strong>{t.invoices.gross}:</strong> {formatAmount(selectedInvoice.brutto_betrag)} {selectedInvoice.waehrung || "EUR"}</div>
                <div><strong>{t.invoices.net}:</strong> {formatAmount(selectedInvoice.netto_betrag)} {selectedInvoice.waehrung || "EUR"}</div>
                <div><strong>{t.invoices.vatAmount}:</strong> {formatAmount(selectedInvoice.mwst_betrag)} {selectedInvoice.waehrung || "EUR"}</div>
                <div><strong>{t.invoices.vatRate}:</strong> {selectedInvoice.mwst_satz || "-"}</div>
                <div><strong>{t.invoices.dueDate}:</strong> {selectedInvoice.faelligkeitsdatum || "-"}</div>
                <div className="search-view-description">
                  <strong>{t.invoices.description}:</strong>
                  <p>{selectedInvoice.beschreibung || "-"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="search-results">
        {!hasQuery ? <p className="empty-note">{t.search.startHint}</p> : null}
        {hasQuery && loading ? <p className="empty-note">{t.common.loading}</p> : null}
        {hasQuery && !loading ? <p className="empty-note">{t.search.resultCount.replace("{count}", String(resultCount))}</p> : null}
        {hasQuery && !loading && resultCount === 0 ? <p className="empty-note">{t.search.empty}</p> : null}

        {hasQuery && !loading && resultCount > 0 ? (
          <div className="rechnungen-grid">
            {invoices.map((invoice) => {
              const fileName = invoice.dateiname || "";
              const fileUrl = `/api/uploads/${encodeURIComponent(fileName)}`;
              const isPdf = fileName.toLowerCase().endsWith(".pdf") || String(invoice.dateityp || "").toLowerCase().includes("pdf");
              return (
                <div className="rechnung-row" key={invoice.id}>
                  <div
                    className="thumb-preview-wrap"
                    onMouseEnter={() => setHoverPreviewId(invoice.id)}
                    onMouseLeave={() => setHoverPreviewId((prev) => (prev === invoice.id ? null : prev))}
                  >
                    <button
                      type="button"
                      className="thumb-btn"
                      title={t.invoices.previewOpen}
                      aria-label={t.invoices.previewOpen}
                      onClick={() => openDetails(invoice)}
                    >
                      {isPdf ? (
                        <object data={`${fileUrl}#page=1&view=FitH`} type="application/pdf" className="rechnung-thumb pdf-thumb">
                          <span className="thumb-pdf">{t.common.pdf}</span>
                        </object>
                      ) : (
                        <img src={fileUrl} className="rechnung-thumb" alt={t.app.name} />
                      )}
                    </button>
                    {hoverPreviewId === invoice.id ? (
                      <div className="search-hover-preview" role="tooltip">
                        {isPdf ? (
                          <object data={`${fileUrl}#page=1&view=FitH`} type="application/pdf" className="search-hover-preview-doc">
                            <span className="thumb-pdf">{t.common.pdf}</span>
                          </object>
                        ) : (
                          <img src={fileUrl} className="search-hover-preview-doc" alt={t.invoices.previewOpen} />
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="row-main">
                    <div className="row-main-top">
                      <span className="rechnung-badge" style={{ background: invoice.farbe || "#95A5A6" }}>
                        {invoice.kategorie_name || t.dashboard.uncategorized}
                      </span>
                      <span className="row-meta"><strong>{renderHighlightedText(invoice.lieferant || t.common.unknown)}</strong></span>
                    </div>
                    <div className="row-main-bottom">
                      <span className="row-meta">{t.search.originalImageName}: {renderHighlightedText(invoice.original_dateiname || "-")}</span>
                      <span className="row-meta">{t.search.savedFileName}: {renderHighlightedText(invoice.dateiname || "-")}</span>
                    </div>
                    <div className="row-main-bottom">
                      <span className="row-meta">{t.invoices.invoiceDateLabel}: {renderHighlightedText(invoice.rechnungsdatum || "-")}</span>
                      <span className="row-meta">{t.invoices.receivedDateLabel}: {renderHighlightedText(String(invoice.hochladezeit || "").slice(0, 19).replace("T", " "))}</span>
                    </div>
                  </div>
                  <div className="row-actions">
                    <div className="row-actions-amount">{formatAmount(invoice.brutto_betrag)} {invoice.waehrung || "EUR"}</div>
                    <div className="row-actions-icons">
                      <button
                        type="button"
                        className="action-square action-view"
                        title={t.common.view}
                        aria-label={t.common.view}
                        onClick={() => openDetails(invoice)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
