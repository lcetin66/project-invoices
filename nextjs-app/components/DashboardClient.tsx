/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Invoice } from "@/lib/types";
import { t, txt } from "@/lang";

type UploadResult = {
  supplier: string;
  category: string;
  total: string;
  quality: number;
};

type UploadApiResponse = {
  ok?: boolean;
  message?: string;
  warning?: string | null;
  datei_name?: string;
  debug?: {
    ocr_text_len?: number;
    ocr_text_preview?: string;
    mode?: string;
    vision_debug?: string;
  } | null;
  ergebnis?: Record<string, unknown>;
  qualitaet_score?: number;
};

type DebugLevel = "info" | "success" | "error";

type DebugEntry = {
  id: number;
  timestamp: string;
  level: DebugLevel;
  title: string;
  detail?: string;
  durationMs?: number;
};

type DashboardClientProps = {
  username: string;
};

function categoryColor(name: string): string {
  const fallback = "#95A5A6";
  const map: Record<string, string> = {
    "Büromaterial": "#E67E22",
    "Software & Hardware": "#9B59B6",
    Transport: "#2ECC71",
    Gastronomie: "#E74C3C",
    Büromiete: "#3498DB",
    Telekommunikation: "#0EA5A6",
    Beratung: "#1ABC9C",
    Marketing: "#F39C12",
    Sonstige: "#95A5A6"
  };
  return map[name] ?? fallback;
}

export function DashboardClient({ username }: DashboardClientProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const debugIdRef = useRef(0);
  const progressMilestonesRef = useRef<Set<number>>(new Set());
  const operationRef = useRef<{
    startedAt: number;
    uploadStartedAt: number | null;
    processingStartedAt: number | null;
  }>({
    startedAt: 0,
    uploadStartedAt: null,
    processingStartedAt: null
  });
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [beschreibung, setBeschreibung] = useState("");
  const [rechnungTyp, setRechnungTyp] = useState("eingang");
  const [rechnungsdatum, setRechnungsdatum] = useState("");
  const [faelligkeitsdatum, setFaelligkeitsdatum] = useState("");

  const [status, setStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [lastFileName, setLastFileName] = useState("");
  const [progressState, setProgressState] = useState({
    open: false,
    title: "Rechnung wird verarbeitet",
    detail: "",
    value: 0
  });
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [activeDurationMs, setActiveDurationMs] = useState(0);

  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const pushDebug = useCallback((level: DebugLevel, title: string, detail = "", durationMs?: number): void => {
    const entry: DebugEntry = {
      id: debugIdRef.current + 1,
      timestamp: new Date().toLocaleTimeString("de-DE", { hour12: false }),
      level,
      title,
      detail: detail || undefined,
      durationMs
    };
    debugIdRef.current = entry.id;
    setDebugEntries((prev) => [entry, ...prev].slice(0, 120));
  }, []);

  function operationDurationMs(): number {
    const startedAt = operationRef.current.startedAt;
    return startedAt > 0 ? Math.max(0, Math.round(performance.now() - startedAt)) : 0;
  }

  async function loadInvoices(): Promise<void> {
    const response = await fetch("/api/invoices?limit=8", { cache: "no-store" });
    const data = (await response.json()) as { invoices?: Invoice[] };
    setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
  }

  useEffect(() => {
    void loadInvoices();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("debug_monitor_enabled");
      if (raw == null) return;
      setDebugEnabled(raw === "1");
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!uploading) {
      setActiveDurationMs(0);
      return;
    }
    const timer = window.setInterval(() => {
      setActiveDurationMs(operationDurationMs());
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [uploading]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      pushDebug("error", "Client-Fehler", event.message || "Unbekannter JavaScript-Fehler");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Unbekannter Promise-Fehler");
      pushDebug("error", "Unhandled Promise Rejection", reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [pushDebug]);

  function stopProgressSimulation(): void {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function startServerPhaseSimulation(): void {
    stopProgressSimulation();
    progressTimerRef.current = window.setInterval(() => {
      setProgressState((prev) => {
        if (!prev.open) return prev;
        const current = Number(prev.value);
        if (current >= 95) {
          return prev;
        }
        const next = current < 88 ? current + 1.2 : current + 0.4;
        return {
          ...prev,
          value: Math.min(95, Number(next.toFixed(1))),
          detail: next >= 89 ? "Ergebnis wird gespeichert..." : "KI-Klassifizierung läuft..."
        };
      });
    }, 320);
  }

  function parseXhrJson(xhr: XMLHttpRequest): UploadApiResponse {
    const payload = xhr.response;
    if (payload && typeof payload === "object") {
      return payload as UploadApiResponse;
    }
    try {
      return JSON.parse(xhr.responseText) as UploadApiResponse;
    } catch {
      return {};
    }
  }

  function uploadWithProgress(formData: FormData): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/invoices", true);
      xhr.responseType = "json";
      xhr.timeout = 180000;

      xhr.upload.onloadstart = () => {
        operationRef.current.uploadStartedAt = performance.now();
        pushDebug("info", "Datei-Upload gestartet");
        setProgressState((prev) => ({
          ...prev,
          value: Math.max(Number(prev.value), 5),
          detail: "Datei wird hochgeladen..."
        }));
      };

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const uploadPercent = Math.round((event.loaded / event.total) * 100);
        const mappedPercent = Math.max(5, Math.min(70, Math.round(uploadPercent * 0.7)));
        for (const milestone of [10, 25, 50, 75, 100]) {
          if (uploadPercent >= milestone && !progressMilestonesRef.current.has(milestone)) {
            progressMilestonesRef.current.add(milestone);
            pushDebug("info", `Upload-Fortschritt ${milestone}%`);
          }
        }
        setProgressState((prev) => ({
          ...prev,
          value: mappedPercent,
          detail: `Datei wird hochgeladen... ${uploadPercent}%`
        }));
      };

      xhr.upload.onload = () => {
        const uploadStart = operationRef.current.uploadStartedAt;
        if (uploadStart) {
          pushDebug("success", "Datei-Upload abgeschlossen", "", Math.round(performance.now() - uploadStart));
        }
        operationRef.current.processingStartedAt = performance.now();
        pushDebug("info", "KI-Verarbeitung gestartet", "Warte auf Python-API Antwort");
        setProgressState((prev) => ({
          ...prev,
          value: Math.max(Number(prev.value), 72),
          detail: "KI-Klassifizierung läuft..."
        }));
        startServerPhaseSimulation();
      };

      xhr.onerror = () => {
        stopProgressSimulation();
        pushDebug("error", "Upload-Netzwerkfehler", "Die Verbindung zur App/API wurde unterbrochen.");
        reject(new Error("Netzwerkfehler beim Upload."));
      };

      xhr.ontimeout = () => {
        stopProgressSimulation();
        pushDebug("error", "Upload-Timeout", "Der Upload hat das Zeitlimit überschritten.");
        reject(new Error("Zeitüberschreitung beim Upload."));
      };

      xhr.onload = () => {
        stopProgressSimulation();
        const payload = parseXhrJson(xhr);
        if (xhr.status < 200 || xhr.status >= 300 || !payload.ok) {
          pushDebug("error", "API-Fehler", payload.message ?? `Upload fehlgeschlagen (${xhr.status})`);
          reject(new Error(payload.message ?? `Upload fehlgeschlagen (${xhr.status})`));
          return;
        }
        const processingStart = operationRef.current.processingStartedAt;
        if (processingStart) {
          pushDebug("success", "KI-Verarbeitung abgeschlossen", "", Math.round(performance.now() - processingStart));
        }
        resolve(payload);
      };

      xhr.send(formData);
    });
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!file) {
      setStatus({ type: "error", text: "Bitte Datei auswählen." });
      return;
    }

    setUploading(true);
    setStatus(null);
    setResult(null);
    progressMilestonesRef.current = new Set();
    operationRef.current = {
      startedAt: performance.now(),
      uploadStartedAt: null,
      processingStartedAt: null
    };
    pushDebug("info", "Neuer Vorgang gestartet", file.name || "Unbekannte Datei");
    setProgressState({
      open: true,
      title: "Rechnung wird verarbeitet",
      detail: "Upload wird vorbereitet...",
      value: 3
    });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("beschreibung", beschreibung);
      formData.append("rechnung_typ", rechnungTyp);
      if (rechnungsdatum) formData.append("rechnungsdatum", rechnungsdatum);
      if (faelligkeitsdatum) formData.append("faelligkeitsdatum", faelligkeitsdatum);

      const data = await uploadWithProgress(formData);

      setProgressState((prev) => ({
        ...prev,
        value: 97,
        detail: "Ergebnis wird gespeichert..."
      }));

      setStatus({ type: "ok", text: "Rechnung erfolgreich verarbeitet." });
      if (data.warning) {
        pushDebug("info", "Teilweise Erkennung", String(data.warning));
      }
      const ocrLen = Number(data.debug?.ocr_text_len ?? 0);
      const ocrPreview = String(data.debug?.ocr_text_preview ?? "").trim();
      const visionDbg = String(data.debug?.vision_debug ?? "").trim();
      const mode = String(data.debug?.mode ?? "").trim();
      pushDebug(
        "info",
        "OCR-Diagnose",
        `Mode: ${mode || "-"} | Textlänge: ${ocrLen}${ocrPreview ? ` | Vorschau: ${ocrPreview.slice(0, 220)}` : ""}${visionDbg ? ` | Vision: ${visionDbg.slice(0, 240)}` : ""}`
      );
      setResult({
        supplier: String(data.ergebnis?.lieferant ?? "Unbekannt"),
        category: String(data.ergebnis?.kategorie ?? "Sonstige"),
        total: String(data.ergebnis?.brutto_betrag ?? "0"),
        quality: Number(data.qualitaet_score ?? 0)
      });
      setLastFileName(String(data.datei_name ?? file.name));

      setFile(null);
      setBeschreibung("");
      setRechnungsdatum("");
      setFaelligkeitsdatum("");
      const input = document.getElementById("rechnung_datei") as HTMLInputElement | null;
      if (input) input.value = "";

      await loadInvoices();
      setProgressState((prev) => ({
        ...prev,
        value: 100,
        detail: "Abgeschlossen."
      }));
      pushDebug("success", "Rechnung erfolgreich verarbeitet", "", operationDurationMs());
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setProgressState((prev) => ({ ...prev, open: false }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Serverfehler beim Upload.";
      setProgressState((prev) => ({
        ...prev,
        value: 100,
        detail: "Vorgang fehlgeschlagen."
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setProgressState((prev) => ({ ...prev, open: false }));
      pushDebug("error", "Verarbeitung fehlgeschlagen", errorMessage, operationDurationMs());
      setStatus({ type: "error", text: errorMessage });
    } finally {
      stopProgressSimulation();
      setUploading(false);
    }
  }

  function applySelectedFile(nextFile: File | null): void {
    setFile(nextFile);
    if (!nextFile || !fileInputRef.current) return;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(nextFile);
      fileInputRef.current.files = transfer.files;
    } catch {
      // Some browsers block FileList assignment; state still drives upload.
    }
  }

  function onDragEnter(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }

  function onDragOver(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }

  function onDragLeave(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }

  function onDrop(event: DragEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const droppedFiles = event.dataTransfer?.files;
    if (droppedFiles && droppedFiles.length > 0) {
      applySelectedFile(droppedFiles[0]);
    }
  }

  return (
    <div className="page-eingabe">
      {progressState.open ? (
        <div className="popup-overlay">
          <div className="popup-card progress-popup" role="status" aria-live="polite">
            <h3>{progressState.title}</h3>
            <p>{progressState.detail}</p>
            <div className="progress-track" aria-label="Upload-Fortschritt">
              <div
                className="progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, Number(progressState.value)))}%` }}
              />
            </div>
            <div className="progress-meta">
              <strong>{Math.round(Number(progressState.value))}%</strong>
              <span>Bitte warten...</span>
            </div>
          </div>
        </div>
      ) : null}

      <section className="upload-section">
        <div className="section-header">
          <div className="section-header-row">
            <h2>{t.dashboard.uploadTitle}</h2>
          </div>
          <p>
            {txt(t.dashboard.uploadGreeting, { username })}
          </p>
        </div>

        {status ? (
          <div className={`alert ${status.type === "ok" ? "alert-success" : "alert-error"}`}>{status.text}</div>
        ) : null}

        <form
          className={`upload-zone${isDragOver ? " dragover" : ""}`}
          onSubmit={(event) => void handleUpload(event)}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <label className="upload-zone-inner" htmlFor="rechnung_datei">
            <div className="upload-icon">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="upload-text">
              <strong>{file ? file.name : t.dashboard.chooseFile}</strong>
              <span>PDF, JPG, PNG, WEBP, HEIC (max 10MB)</span>
            </div>
            <input
              id="rechnung_datei"
              className="file-input"
              type="file"
              ref={fileInputRef}
              accept=".pdf,.jpg,.jpeg,.png,.gif,.tif,.tiff,.webp,.heic,.heif"
              onChange={(event) => applySelectedFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>

          <div className="upload-actions">
            <div className="upload-field">
              <label>{t.dashboard.type}</label>
              <select value={rechnungTyp} onChange={(event) => setRechnungTyp(event.target.value)}>
                <option value="eingang">Eingang</option>
                <option value="ausgang">Ausgang</option>
              </select>
            </div>
            <div className="upload-field">
              <label>{t.dashboard.invoiceDate}</label>
              <input type="date" value={rechnungsdatum} onChange={(event) => setRechnungsdatum(event.target.value)} />
            </div>
            <div className="upload-field">
              <label>{t.dashboard.dueDate}</label>
              <input
                type="date"
                value={faelligkeitsdatum}
                onChange={(event) => setFaelligkeitsdatum(event.target.value)}
              />
            </div>
            <div className="upload-field upload-field-wide">
              <label>{t.dashboard.description}</label>
              <input type="text" value={beschreibung} onChange={(event) => setBeschreibung(event.target.value)} placeholder={t.dashboard.note} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={uploading || !file}>
              {uploading ? t.dashboard.processing : t.dashboard.upload}
            </button>
          </div>
        </form>
      </section>

      {result ? (
        <section className="ergebnis-section fade-in">
          <div className="section-header">
            <h2>Klassifizierungsergebnis</h2>
          </div>
          <div className="ergebnis-container">
            <div className="ergebnis-preview-card">
              {lastFileName.toLowerCase().endsWith(".pdf") ? (
                <object
                  data={`/api/uploads/${encodeURIComponent(lastFileName)}#page=1&view=FitH`}
                  type="application/pdf"
                  className="ergebnis-doc-preview"
                />
              ) : (
                <img
                  src={`/api/uploads/${encodeURIComponent(lastFileName)}`}
                  alt="Rechnung Vorschau"
                  className="ergebnis-img-preview"
                />
              )}
            </div>
            <div className="ergebnis-card">
              <span className="ergebnis-badge" style={{ background: categoryColor(result.category) }}>
                {result.category}
              </span>
              <div className="ergebnis-grid">
                <div className="ergebnis-item">
                  <span className="ergebnis-label">Lieferant</span>
                  <span className="ergebnis-value">{result.supplier}</span>
                </div>
                <div className="ergebnis-item">
                  <span className="ergebnis-label">Brutto Betrag</span>
                  <span className="ergebnis-value highlight">{result.total} EUR</span>
                </div>
                <div className="ergebnis-item">
                  <span className="ergebnis-label">Qualität Score</span>
                  <span className="ergebnis-value">{result.quality}/100</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rechnungen-section">
        <div className="section-header">
          <h2>{t.dashboard.latestInvoices}</h2>
        </div>
        {invoices.length === 0 ? (
          <div className="empty-state">
            <p>{t.dashboard.noInvoices}</p>
          </div>
        ) : (
          <div className="rechnungen-grid">
            {invoices.map((invoice) => {
              const fileName = invoice.dateiname || "";
              const isPdf = fileName.toLowerCase().endsWith(".pdf") || invoice.dateityp.includes("pdf");
              return (
                <div className="rechnung-card fade-in" key={invoice.id}>
                  <div className="rechnung-card-header">
                    <span
                      className="rechnung-badge"
                      style={{ background: invoice.farbe || categoryColor(invoice.kategorie_name || "Sonstige") }}
                    >
                      {invoice.kategorie_name || "Nicht kategorisiert"}
                    </span>
                    <span className="rechnung-datum">{String(invoice.hochladezeit).slice(0, 10)}</span>
                  </div>
                  <div className="rechnung-card-body">
                    <div className="rechnung-vorschau">
                      {isPdf ? (
                        <object
                          data={`/api/uploads/${encodeURIComponent(fileName)}#page=1&view=FitH`}
                          type="application/pdf"
                          className="rechnung-thumb pdf-thumb"
                        />
                      ) : (
                        <img src={`/api/uploads/${encodeURIComponent(fileName)}`} className="rechnung-thumb" alt="Rechnung" />
                      )}
                    </div>
                    <div className="rechnung-info">
                      <strong>{invoice.lieferant || "Unbekannt"}</strong>
                      <span className="rechnung-betrag">{(invoice.brutto_betrag ?? 0).toFixed(2)} EUR</span>
                      <span className="rechnung-desc">{invoice.beschreibung || "-"}</span>
                    </div>
                  </div>
                  <div className="rechnung-card-footer">
                    <a className="btn btn-sm btn-outline" href={`/api/uploads/${encodeURIComponent(fileName)}`} target="_blank" rel="noreferrer">
                      Ansehen
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {debugEnabled ? (
      <section className="debug-dock open" aria-live="polite">
        <div className="debug-monitor">
          <div className="debug-monitor-head">
            <h3>{t.dashboard.debugTitle}</h3>
            <div className="debug-monitor-actions">
              <button type="button" className="debug-btn" onClick={() => setDebugEntries([])}>
                {t.dashboard.clear}
              </button>
            </div>
          </div>
          <div className="debug-monitor-meta">
            <span>{t.dashboard.entries}: {debugEntries.length}</span>
            <span>{t.dashboard.runtime}: {uploading ? `${activeDurationMs} ms` : "-"}</span>
          </div>
            <div className="debug-monitor-body">
              {debugEntries.length === 0 ? <p className="debug-empty">{t.dashboard.noDebug}</p> : null}
              {debugEntries.map((entry) => (
                <div key={entry.id} className={`debug-entry debug-${entry.level}`}>
                  <div className="debug-entry-line">
                    <strong>{entry.title}</strong>
                    <span>{entry.timestamp}</span>
                  </div>
                  {entry.durationMs != null ? <div className="debug-entry-duration">Dauer: {entry.durationMs} ms</div> : null}
                  {entry.detail ? <p>{entry.detail}</p> : null}
                </div>
              ))}
            </div>
        </div>
      </section>
      ) : null}
    </div>
  );
}
