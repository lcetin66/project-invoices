/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, type DragEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  duplicate?: boolean;
  message?: string;
  warning?: string | null;
  datei_name?: string;
  previousInvoice?: {
    id?: number;
    dateiname?: string;
    dateityp?: string;
    lieferant?: string | null;
    brutto_betrag?: number | null;
    rechnungsdatum?: string | null;
  } | null;
  debug?: {
    ocr_text_len?: number;
    ocr_text_preview?: string;
    mode?: string;
    vision_debug?: string;
  } | null;
  ergebnis?: Record<string, unknown>;
  qualitaet_score?: number;
};

type UploadRequestError = Error & {
  status?: number;
  payload?: UploadApiResponse;
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

type Point = {
  x: number;
  y: number;
};

type EditorDragState =
  | { type: "point"; index: number }
  | { type: "rotate"; startAngle: number; startRotation: number }
  | { type: "pan"; startX: number; startY: number; startPanX: number; startPanY: number }
  | null;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "tif", "tiff", "webp", "heic", "heif"]);

function isImageFile(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.toLowerCase().startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerInElement(event: PointerEvent | ReactPointerEvent, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function samplePixel(source: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number, number] {
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = source[i00 + channel] * (1 - tx) + source[i10 + channel] * tx;
    const bottom = source[i01 + channel] * (1 - tx) + source[i11 + channel] * tx;
    out[channel] = top * (1 - ty) + bottom * ty;
  }

  return out;
}

function imageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht gelesen werden."));
    };
    image.src = url;
  });
}

async function looksLikeCleanInvoiceImage(file: File): Promise<boolean> {
  const image = await imageFromFile(file);
  const maxEdge = 360;
  const scale = Math.min(maxEdge / image.naturalWidth, maxEdge / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const border = Math.max(4, Math.round(Math.min(width, height) * 0.05));
  let white = 0;
  let total = 0;
  let borderWhite = 0;
  let borderTotal = 0;
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const brightness = (r + g + b) / 3;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      const isWhite = brightness > 232 && saturation < 36;
      const isContent = brightness < 218 || saturation > 58;

      total += 1;
      if (isWhite) white += 1;
      if (x < border || y < border || x >= width - border || y >= height - border) {
        borderTotal += 1;
        if (isWhite) borderWhite += 1;
        borderR += r;
        borderG += g;
        borderB += b;
      }
      if (isContent) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const whiteRatio = white / Math.max(1, total);
  const borderWhiteRatio = borderWhite / Math.max(1, borderTotal);
  const contentWidthRatio = (maxX - minX + 1) / Math.max(1, width);
  const contentHeightRatio = (maxY - minY + 1) / Math.max(1, height);
  const contentTouchesPage = minX < width * 0.18 && maxX > width * 0.72 && minY < height * 0.18 && maxY > height * 0.72;
  const avgBorderR = borderR / Math.max(1, borderTotal);
  const avgBorderG = borderG / Math.max(1, borderTotal);
  const avgBorderB = borderB / Math.max(1, borderTotal);
  const dominantBorder = Math.max(avgBorderR, avgBorderG, avgBorderB);
  const borderSpread = dominantBorder - Math.min(avgBorderR, avgBorderG, avgBorderB);

  // Sadece gercekten "duz/temiz tarama"ysa editoru atla.
  const likelyCleanScan =
    borderWhiteRatio > 0.86 &&
    whiteRatio > 0.72 &&
    contentWidthRatio > 0.74 &&
    contentHeightRatio > 0.74 &&
    contentTouchesPage &&
    borderSpread < 16;

  // Arka planli, egik veya kadraj zayif goruntu: editor ac.
  const likelyBackgroundOrSkewed =
    borderWhiteRatio < 0.76 ||
    whiteRatio < 0.66 ||
    borderSpread > 19 ||
    !contentTouchesPage ||
    contentWidthRatio < 0.7 ||
    contentHeightRatio < 0.7;

  if (likelyCleanScan) return true;
  if (likelyBackgroundOrSkewed) return false;

  // Belirsiz durumda guvenli tercih: editor ac.
  return false;
}

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
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [beschreibung, setBeschreibung] = useState("");
  const [rechnungTyp, setRechnungTyp] = useState("eingang");
  const [rechnungsdatum, setRechnungsdatum] = useState("");
  const [faelligkeitsdatum, setFaelligkeitsdatum] = useState("");

  const [status, setStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [duplicateModal, setDuplicateModal] = useState<UploadApiResponse["previousInvoice"]>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [lastFileName, setLastFileName] = useState("");
  const [progressState, setProgressState] = useState({
    open: false,
    title: t.dashboard.progressTitle,
    detail: "",
    value: 0
  });
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [debugMinimized, setDebugMinimized] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [activeDurationMs, setActiveDurationMs] = useState(0);
  const lastOrientationLockedRef = useRef(false);

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
      pushDebug("error", t.dashboard.clientError, event.message || t.dashboard.unknownJsError);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error ? event.reason.message : String(event.reason ?? t.dashboard.unknownPromiseError);
      pushDebug("error", t.dashboard.promiseRejection, reason);
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
          detail: next >= 89 ? t.dashboard.progressSaving : t.dashboard.progressClassifying
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
        pushDebug("info", t.dashboard.uploadStarted);
        setProgressState((prev) => ({
          ...prev,
          value: Math.max(Number(prev.value), 5),
          detail: t.dashboard.progressUploading
        }));
      };

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const uploadPercent = Math.round((event.loaded / event.total) * 100);
        const mappedPercent = Math.max(5, Math.min(70, Math.round(uploadPercent * 0.7)));
        for (const milestone of [10, 25, 50, 75, 100]) {
          if (uploadPercent >= milestone && !progressMilestonesRef.current.has(milestone)) {
            progressMilestonesRef.current.add(milestone);
            pushDebug("info", txt(t.dashboard.uploadProgress, { percent: String(milestone) }));
          }
        }
        setProgressState((prev) => ({
          ...prev,
          value: mappedPercent,
          detail: `${t.dashboard.progressUploading} ${uploadPercent}%`
        }));
      };

      xhr.upload.onload = () => {
        const uploadStart = operationRef.current.uploadStartedAt;
        if (uploadStart) {
          pushDebug("success", t.dashboard.uploadCompleted, "", Math.round(performance.now() - uploadStart));
        }
        operationRef.current.processingStartedAt = performance.now();
        pushDebug("info", t.dashboard.processingStarted, t.dashboard.waitingForPython);
        setProgressState((prev) => ({
          ...prev,
          value: Math.max(Number(prev.value), 72),
          detail: t.dashboard.progressClassifying
        }));
        startServerPhaseSimulation();
      };

      xhr.onerror = () => {
        stopProgressSimulation();
        pushDebug("error", t.dashboard.networkErrorTitle, t.dashboard.networkErrorText);
        reject(new Error(t.dashboard.networkError));
      };

      xhr.ontimeout = () => {
        stopProgressSimulation();
        pushDebug("error", t.dashboard.timeoutTitle, t.dashboard.timeoutText);
        reject(new Error(t.dashboard.timeoutError));
      };

      xhr.onload = () => {
        stopProgressSimulation();
        const payload = parseXhrJson(xhr);
        if (xhr.status < 200 || xhr.status >= 300 || !payload.ok) {
          pushDebug("error", t.dashboard.apiError, payload.message ?? `${t.dashboard.uploadFailed} (${xhr.status})`);
          const err = new Error(payload.message ?? `${t.dashboard.uploadFailed} (${xhr.status})`) as UploadRequestError;
          err.status = xhr.status;
          err.payload = payload;
          reject(err);
          return;
        }
        const processingStart = operationRef.current.processingStartedAt;
        if (processingStart) {
          pushDebug("success", t.dashboard.processingCompleted, "", Math.round(performance.now() - processingStart));
        }
        resolve(payload);
      };

      xhr.send(formData);
    });
  }

  async function checkDuplicatePreUpload(selectedFile: File): Promise<UploadApiResponse | null> {
    const formData = new FormData();
    formData.append("file", selectedFile);
    const response = await fetch("/api/invoices?check_duplicate=1", {
      method: "POST",
      body: formData
    });
    const payload = (await response.json().catch(() => ({}))) as UploadApiResponse;
    if (response.status === 409 && payload.duplicate) {
      return payload;
    }
    if (!response.ok) {
      throw new Error(payload.message ?? `${t.dashboard.uploadFailed} (${response.status})`);
    }
    return null;
  }

  async function uploadInvoice(selectedFile: File | null, forceDuplicate = false, orientationLocked = false): Promise<void> {
    if (!selectedFile) {
      setStatus({ type: "error", text: t.dashboard.selectFileError });
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
    lastOrientationLockedRef.current = orientationLocked;
    pushDebug("info", t.dashboard.newProcess, selectedFile.name || t.common.unknown);
    setProgressState({
      open: true,
      title: t.dashboard.progressTitle,
      detail: t.dashboard.progressPreparing,
      value: 3
    });

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("beschreibung", beschreibung);
      formData.append("rechnung_typ", rechnungTyp);
      if (rechnungsdatum) formData.append("rechnungsdatum", rechnungsdatum);
      if (faelligkeitsdatum) formData.append("faelligkeitsdatum", faelligkeitsdatum);
      if (forceDuplicate) formData.append("force_duplicate", "1");
      if (orientationLocked) formData.append("orientation_locked", "1");

      const data = await uploadWithProgress(formData);

      setProgressState((prev) => ({
        ...prev,
        value: 97,
        detail: t.dashboard.progressSaving
      }));

      setStatus({ type: "ok", text: t.dashboard.processedOk });
      setDuplicateModal(null);
      if (data.warning) {
        pushDebug("info", t.dashboard.partialDetection, String(data.warning));
      }
      const ocrLen = Number(data.debug?.ocr_text_len ?? 0);
      const ocrPreview = String(data.debug?.ocr_text_preview ?? "").trim();
      const visionDbg = String(data.debug?.vision_debug ?? "").trim();
      const mode = String(data.debug?.mode ?? "").trim();
      pushDebug(
        "info",
        t.dashboard.ocrDiagnostics,
        `${t.dashboard.debugMode}: ${mode || "-"} | ${t.dashboard.debugTextLength}: ${ocrLen}${ocrPreview ? ` | ${t.dashboard.debugPreview}: ${ocrPreview.slice(0, 220)}` : ""}${visionDbg ? ` | ${t.dashboard.debugVision}: ${visionDbg.slice(0, 240)}` : ""}`
      );
      setResult({
        supplier: String(data.ergebnis?.lieferant ?? t.common.unknown),
        category: String(data.ergebnis?.kategorie ?? "Sonstige"),
        total: String(data.ergebnis?.brutto_betrag ?? "0"),
        quality: Number(data.qualitaet_score ?? 0)
      });
      setLastFileName(String(data.datei_name ?? selectedFile.name));

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
        detail: t.dashboard.progressDone
      }));
      pushDebug("success", t.dashboard.processedOk, "", operationDurationMs());
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setProgressState((prev) => ({ ...prev, open: false }));
    } catch (error) {
      const uploadError = error as UploadRequestError;
      if (uploadError?.status === 409 && uploadError.payload?.duplicate && uploadError.payload.previousInvoice) {
        setDuplicateModal(uploadError.payload.previousInvoice);
      }
      const errorMessage = error instanceof Error ? error.message : t.dashboard.serverUploadError;
      setProgressState((prev) => ({
        ...prev,
        value: 100,
        detail: t.dashboard.progressFailed
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setProgressState((prev) => ({ ...prev, open: false }));
      pushDebug("error", t.dashboard.processingFailed, errorMessage, operationDurationMs());
      setStatus({ type: "error", text: errorMessage });
    } finally {
      stopProgressSimulation();
      setUploading(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await uploadInvoice(file);
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

  async function handleIncomingFile(nextFile: File | null): Promise<void> {
    applySelectedFile(nextFile);
    if (!nextFile) return;

    if (!isImageFile(nextFile)) {
      await uploadInvoice(nextFile);
      return;
    }

    setStatus({ type: "ok", text: "Bild wird geprüft..." });
    try {
      const duplicatePayload = await checkDuplicatePreUpload(nextFile);
      if (duplicatePayload?.duplicate) {
        const duplicateMessage = String(duplicatePayload.message ?? t.api.duplicateInvoiceProcessed);
        setStatus({ type: "error", text: duplicateMessage });
        pushDebug("error", t.dashboard.apiError, duplicateMessage);
        setDuplicateModal(
          duplicatePayload.previousInvoice ?? {
            dateiname: nextFile.name,
            dateityp: nextFile.type || "image/*",
            lieferant: null,
            brutto_betrag: null,
            rechnungsdatum: null
          }
        );
        return;
      }
      const clean = await looksLikeCleanInvoiceImage(nextFile);
      if (clean) {
        pushDebug("info", "Sauberes Bild erkannt", "Ohne Editor direkt verarbeitet.");
        await uploadInvoice(nextFile);
      } else {
        pushDebug("info", "Bild mit Hintergrund erkannt", "Editor-Popup wird geöffnet.");
        setEditorFile(nextFile);
      }
    } catch (error) {
      const checkError = error instanceof Error ? error.message : "";
      pushDebug("error", "Bildprüfung fehlgeschlagen", checkError);
      setStatus({ type: "error", text: checkError || t.dashboard.serverUploadError });
      setEditorFile(nextFile);
    }
  }

  async function acceptEditedFile(editedFile: File): Promise<void> {
    setEditorFile(null);
    applySelectedFile(editedFile);
    await uploadInvoice(editedFile, false, true);
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
      void handleIncomingFile(droppedFiles[0]);
    }
  }

  return (
    <div className="page-eingabe">
      {progressState.open ? (
        <div className="popup-overlay">
          <div className="popup-card progress-popup" role="status" aria-live="polite">
            <h3>{progressState.title}</h3>
            <p>{progressState.detail}</p>
            <div className="progress-track" aria-label={t.dashboard.uploadProgress.replace("{percent}", "")}>
              <div
                className="progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, Number(progressState.value)))}%` }}
              />
            </div>
            <div className="progress-meta">
              <strong>{Math.round(Number(progressState.value))}%</strong>
              <span>{t.dashboard.pleaseWait}</span>
            </div>
          </div>
        </div>
      ) : null}

      {editorFile ? (
        <DashboardImageEditorModal
          file={editorFile}
          onCancel={() => setEditorFile(null)}
          onConfirm={(editedFile) => void acceptEditedFile(editedFile)}
        />
      ) : null}

      {duplicateModal ? (
        <div className="popup-overlay">
          <div className="popup-card duplicate-popup" role="dialog" aria-modal="true">
            <h3>{t.dashboard.duplicateTitle}</h3>
            <p>{t.dashboard.duplicateText}</p>
            <div className="duplicate-grid">
              <div className="duplicate-preview">
                {String(duplicateModal.dateiname || "").toLowerCase().endsWith(".pdf") ? (
                  <object
                    data={`/api/uploads/${encodeURIComponent(String(duplicateModal.dateiname || ""))}#page=1&view=FitH`}
                    type="application/pdf"
                    className="duplicate-doc"
                  />
                ) : (
                  <img
                    src={`/api/uploads/${encodeURIComponent(String(duplicateModal.dateiname || ""))}`}
                    alt={t.dashboard.duplicatePreviewAlt}
                    className="duplicate-doc"
                  />
                )}
              </div>
              <div className="duplicate-meta">
                <strong>{duplicateModal.lieferant || t.common.unknown}</strong>
                <span>{t.dashboard.invoiceDate}: {duplicateModal.rechnungsdatum || "-"}</span>
                <span>{t.dashboard.grossAmount}: {duplicateModal.brutto_betrag != null ? `${Number(duplicateModal.brutto_betrag).toFixed(2)} EUR` : "-"}</span>
              </div>
            </div>
            <div className="duplicate-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDuplicateModal(null)}>
                {t.common.ok}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setDuplicateModal(null);
                  void uploadInvoice(file, true, lastOrientationLockedRef.current);
                }}
              >
                {t.dashboard.duplicateProceed}
              </button>
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
              <span>{t.dashboard.fileTypesHint}</span>
            </div>
            <input
              id="rechnung_datei"
              className="file-input"
              type="file"
              ref={fileInputRef}
              accept=".pdf,.jpg,.jpeg,.png,.gif,.tif,.tiff,.webp,.heic,.heif"
              onChange={(event) => void handleIncomingFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>

          <div className="upload-actions">
            <div className="upload-field">
              <label>{t.dashboard.type}</label>
              <select value={rechnungTyp} onChange={(event) => setRechnungTyp(event.target.value)}>
                <option value="eingang">{t.dashboard.inputTypeIncoming}</option>
                <option value="ausgang">{t.dashboard.inputTypeOutgoing}</option>
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
            <h2>{t.dashboard.resultTitle}</h2>
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
                  alt={t.dashboard.resultPreviewAlt}
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
                  <span className="ergebnis-label">{t.dashboard.supplier}</span>
                  <span className="ergebnis-value">{result.supplier}</span>
                </div>
                <div className="ergebnis-item">
                  <span className="ergebnis-label">{t.dashboard.grossAmount}</span>
                  <span className="ergebnis-value highlight">{result.total} EUR</span>
                </div>
                <div className="ergebnis-item">
                  <span className="ergebnis-label">{t.dashboard.qualityScore}</span>
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
                      {invoice.kategorie_name || t.dashboard.uncategorized}
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
                        <img src={`/api/uploads/${encodeURIComponent(fileName)}`} className="rechnung-thumb" alt={t.app.name} />
                      )}
                    </div>
                    <div className="rechnung-info">
                      <strong>{invoice.lieferant || t.common.unknown}</strong>
                      <span className="rechnung-betrag">{(invoice.brutto_betrag ?? 0).toFixed(2)} EUR</span>
                      <span className="rechnung-desc">{invoice.beschreibung || "-"}</span>
                    </div>
                  </div>
                  <div className="rechnung-card-footer">
                    <a className="btn btn-sm btn-outline" href={`/api/uploads/${encodeURIComponent(fileName)}`} target="_blank" rel="noreferrer">
                      {t.dashboard.view}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {debugEnabled ? (
      <section className={`debug-dock ${debugMinimized ? "collapsed" : "open"}`} aria-live="polite">
        <div className="debug-monitor">
          <div className="debug-monitor-head">
            <h3>{t.dashboard.debugTitle}</h3>
            <div className="debug-monitor-actions">
              <button type="button" className="debug-btn" onClick={() => setDebugEntries([])}>
                {t.dashboard.clear}
              </button>
              <button type="button" className="debug-btn" onClick={() => setDebugMinimized((prev) => !prev)}>
                {debugMinimized ? t.dashboard.open : t.dashboard.minimize}
              </button>
            </div>
          </div>
          <div className="debug-monitor-meta">
            <span>{t.dashboard.entries}: {debugEntries.length}</span>
            <span>{t.dashboard.runtime}: {uploading ? `${activeDurationMs} ms` : "-"}</span>
          </div>
            {!debugMinimized ? (
            <div className="debug-monitor-body">
              {debugEntries.length === 0 ? <p className="debug-empty">{t.dashboard.noDebug}</p> : null}
              {debugEntries.map((entry) => (
                <div key={entry.id} className={`debug-entry debug-${entry.level}`}>
                  <div className="debug-entry-line">
                    <strong>{entry.title}</strong>
                    <span>{entry.timestamp}</span>
                  </div>
                  {entry.durationMs != null ? <div className="debug-entry-duration">{t.dashboard.duration}: {entry.durationMs} ms</div> : null}
                  {entry.detail ? <p>{entry.detail}</p> : null}
                </div>
              ))}
            </div>
            ) : null}
        </div>
      </section>
      ) : null}
    </div>
  );
}

function getContainedImageRect(stage: Point, image: Point): { left: number; top: number; width: number; height: number } {
  if (!image.x || !image.y || !stage.x || !stage.y) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(stage.x / image.x, stage.y / image.y);
  const width = image.x * scale;
  const height = image.y * scale;
  return {
    left: (stage.x - width) / 2,
    top: (stage.y - height) / 2,
    width,
    height
  };
}

function defaultEditorPoints(stage: Point, image: Point): Point[] {
  const rect = getContainedImageRect(stage, image);
  const insetX = 10;
  const insetY = 10;
  const availableWidth = Math.max(40, rect.width - insetX * 2);
  const availableHeight = Math.max(60, rect.height - insetY * 2);
  const isLandscape = rect.width >= rect.height;
  const baseWidth = isLandscape ? availableWidth * 0.56 : availableWidth * 0.8;
  const baseHeight = isLandscape ? availableHeight * 0.8 : availableHeight * 0.9;
  const bottomWidth = Math.max(40, Math.min(availableWidth, baseWidth));
  const topWidth = Math.max(30, bottomWidth * 0.94);
  const trapHeight = Math.max(60, Math.min(availableHeight, baseHeight));
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const topY = centerY - trapHeight / 2;
  const bottomY = centerY + trapHeight / 2;
  return [
    { x: centerX - topWidth / 2, y: topY },
    { x: centerX + topWidth / 2, y: topY },
    { x: centerX + bottomWidth / 2, y: bottomY },
    { x: centerX - bottomWidth / 2, y: bottomY }
  ];
}

function imageCenterOnStage(stage: Point, pan: Point): Point {
  return { x: stage.x / 2 + pan.x, y: stage.y / 2 + pan.y };
}

function localToStagePoint(local: Point, stage: Point, pan: Point, rotationDeg: number): Point {
  const center = imageCenterOnStage(stage, pan);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: center.x + local.x * cos - local.y * sin,
    y: center.y + local.x * sin + local.y * cos
  };
}

function stageToLocalPoint(stagePoint: Point, stage: Point, pan: Point, rotationDeg: number): Point {
  const center = imageCenterOnStage(stage, pan);
  const dx = stagePoint.x - center.x;
  const dy = stagePoint.y - center.y;
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png", 0.96));
}

function rotateCanvasByDegrees(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const normalized = ((degrees % 360) + 360) % 360;
  if (Math.abs(normalized) < 0.001) return source;

  const rad = (normalized * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = source.width;
  const h = source.height;
  const outW = Math.max(1, Math.round(w * cos + h * sin));
  const outH = Math.max(1, Math.round(w * sin + h * cos));

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -w / 2, -h / 2);
  return out;
}

type DashboardImageEditorModalProps = {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

type EditorStep = "rotate" | "trapez" | "preview";

function DashboardImageEditorModal({ file, onCancel, onConfirm }: DashboardImageEditorModalProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<EditorDragState>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState<Point>({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState<Point>({ x: 720, y: 520 });
  const [points, setPoints] = useState<Point[]>([]);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [isBW, setIsBW] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const previewUrlRef = useRef("");
  const [editorStep, setEditorStep] = useState<EditorStep>("rotate");
  const [error, setError] = useState("");
  const loadedRef = useRef(false);

  const imageRect = useMemo(() => getContainedImageRect(stageSize, imageSize), [stageSize, imageSize]);
  const displayedImageSize = {
    x: imageRect.width * zoom,
    y: imageRect.height * zoom
  };
  const pointsStage = useMemo(
    () => points.map((point) => localToStagePoint(point, stageSize, pan, rotation)),
    [points, stageSize, pan, rotation]
  );
  const polygon = pointsStage.map((point) => `${point.x},${point.y}`).join(" ");
  const center = imageCenterOnStage(stageSize, pan);
  const rotateHandle = {
    x: center.x + Math.sin((rotation * Math.PI) / 180) * -120,
    y: center.y + Math.cos((rotation * Math.PI) / 180) * -120
  };

  useEffect(() => {
    loadedRef.current = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      loadedRef.current = true;
      imageRef.current = image;
      setError("");
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      setPreviewUrl("");
      setPreviewFile(null);
      setEditorStep("rotate");
      setImageUrl(url);
      setImageSize({ x: image.naturalWidth, y: image.naturalHeight });
      setRotation(0);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setBrightness(100);
      setContrast(100);
      setIsBW(false);
    };
    image.onerror = () => {
      if (loadedRef.current) return;
      URL.revokeObjectURL(url);
      setError("Bild konnte im Editor nicht geöffnet werden. Sie können mit der Originaldatei fortfahren.");
    };
    image.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        x: entry.contentRect.width,
        y: entry.contentRect.height
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (imageSize.x && imageSize.y) {
      const defaults = defaultEditorPoints(stageSize, imageSize);
      const localDefaults = defaults.map((p) => stageToLocalPoint(p, stageSize, { x: 0, y: 0 }, 0));
      setPoints(localDefaults);
    }
  }, [imageSize, stageSize]); // intentional: initialize points once for new stage/image

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const stage = stageRef.current;
      if (!stage || !dragRef.current) return;
      const pointer = pointerInElement(event, stage);
      if (dragRef.current.type === "point") {
        const index = dragRef.current.index;
        const local = stageToLocalPoint(pointer, stageSize, pan, rotation);
        const halfW = displayedImageSize.x / 2;
        const halfH = displayedImageSize.y / 2;
        setPoints((current) =>
          current.map((point, pointIndex) =>
            pointIndex === index
              ? {
                  x: clamp(local.x, -halfW, halfW),
                  y: clamp(local.y, -halfH, halfH)
                }
              : point
          )
        );
        return;
      }
      if (dragRef.current.type === "pan") {
        const dx = pointer.x - dragRef.current.startX;
        const dy = pointer.y - dragRef.current.startY;
        setPan({
          x: dragRef.current.startPanX + dx,
          y: dragRef.current.startPanY + dy
        });
        return;
      }

      const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI);
      setRotation(dragRef.current.startRotation + angle - dragRef.current.startAngle);
    }

    function onUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [center.x, center.y, displayedImageSize.x, displayedImageSize.y, pan, rotation, stageSize, stageSize.x, stageSize.y]);

  function startDrag(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragRef.current = { type: "point", index };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startRotate(event: ReactPointerEvent<HTMLButtonElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = pointerInElement(event, stage);
    dragRef.current = {
      type: "rotate",
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI),
      startRotation: rotation
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startPan(event: ReactPointerEvent<HTMLImageElement>) {
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = pointerInElement(event, stage);
    dragRef.current = {
      type: "pan",
      startX: pointer.x,
      startY: pointer.y,
      startPanX: pan.x,
      startPanY: pan.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  async function buildEditedFile(): Promise<File | null> {
    const image = imageRef.current;
    if (!image || points.length !== 4) return null;

    const imageScaleX = (imageRect.width * zoom) / Math.max(1, image.naturalWidth);
    const imageScaleY = (imageRect.height * zoom) / Math.max(1, image.naturalHeight);
    const localToSource = (p: Point): Point => ({
      x: clamp((p.x + (imageRect.width * zoom) / 2) / Math.max(imageScaleX, 1e-6), 0, image.naturalWidth - 1),
      y: clamp((p.y + (imageRect.height * zoom) / 2) / Math.max(imageScaleY, 1e-6), 0, image.naturalHeight - 1)
    });
    const sourcePoints = points.map(localToSource);
    const [sTopLeft, sTopRight, sBottomRight, sBottomLeft] = sourcePoints;

    const outputWidth = Math.max(
      120,
      Math.round((distance(sTopLeft, sTopRight) + distance(sBottomLeft, sBottomRight)) / 2)
    );
    const outputHeight = Math.max(
      120,
      Math.round((distance(sTopLeft, sBottomLeft) + distance(sTopRight, sBottomRight)) / 2)
    );
    const longestSide = Math.max(outputWidth, outputHeight);
    const targetScale = longestSide > 3200 ? 3200 / longestSide : 1;
    const finalWidth = Math.max(120, Math.round(outputWidth * targetScale));
    const finalHeight = Math.max(120, Math.round(outputHeight * targetScale));

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return null;
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = "high";
    sourceContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = finalWidth;
    outputCanvas.height = finalHeight;
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) return null;

    const sourceImage = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const result = outputContext.createImageData(outputCanvas.width, outputCanvas.height);

    for (let y = 0; y < outputCanvas.height; y += 1) {
      const v = outputCanvas.height === 1 ? 0 : y / (outputCanvas.height - 1);
      for (let x = 0; x < outputCanvas.width; x += 1) {
        const u = outputCanvas.width === 1 ? 0 : x / (outputCanvas.width - 1);
        const sourceX =
          sTopLeft.x * (1 - u) * (1 - v) +
          sTopRight.x * u * (1 - v) +
          sBottomRight.x * u * v +
          sBottomLeft.x * (1 - u) * v;
        const sourceY =
          sTopLeft.y * (1 - u) * (1 - v) +
          sTopRight.y * u * (1 - v) +
          sBottomRight.y * u * v +
          sBottomLeft.y * (1 - u) * v;
        const pixel = samplePixel(sourceImage.data, sourceCanvas.width, sourceCanvas.height, sourceX, sourceY);
        const target = (y * outputCanvas.width + x) * 4;
        result.data[target] = pixel[0];
        result.data[target + 1] = pixel[1];
        result.data[target + 2] = pixel[2];
        result.data[target + 3] = pixel[3];
      }
    }

    outputContext.putImageData(result, 0, 0);
    if (brightness !== 100 || contrast !== 100 || isBW) {
      const filteredCanvas = document.createElement("canvas");
      filteredCanvas.width = outputCanvas.width;
      filteredCanvas.height = outputCanvas.height;
      const filteredCtx = filteredCanvas.getContext("2d");
      if (filteredCtx) {
        filteredCtx.filter = `brightness(${brightness}%) contrast(${contrast}%) ${isBW ? "grayscale(100%)" : "grayscale(0%)"}`;
        filteredCtx.drawImage(outputCanvas, 0, 0);
        outputContext.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
        outputContext.drawImage(filteredCanvas, 0, 0);
      }
    }
    const orientationAdjusted = Math.abs(rotation) > 0.5 ? rotateCanvasByDegrees(outputCanvas, rotation) : outputCanvas;
    const blob = await canvasBlob(orientationAdjusted);
    if (!blob) {
      setError("Duzeltilmis resim olusturulamadi.");
      return null;
    }

    return new File([blob], `editor-${file.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
  }

  async function confirmCrop() {
    const edited = await buildEditedFile();
    if (!edited) return;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    const url = URL.createObjectURL(edited);
    setPreviewFile(edited);
    setPreviewUrl(url);
    setEditorStep("preview");
  }

  const stepTitle =
    editorStep === "rotate"
      ? t.dashboard.editorStepRotate
      : editorStep === "trapez"
        ? t.dashboard.editorStepTrapez
        : t.dashboard.editorStepPreview;
  const stepDescription =
    editorStep === "rotate"
      ? t.dashboard.editorDescRotate
      : editorStep === "trapez"
        ? t.dashboard.editorDescTrapez
        : t.dashboard.editorDescPreview;

  function handlePrimaryStep(): void {
    if (editorStep === "rotate") {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      const defaults = defaultEditorPoints(stageSize, imageSize);
      const localDefaults = defaults.map((p) => stageToLocalPoint(p, stageSize, { x: 0, y: 0 }, 0));
      setPoints(localDefaults);
      setEditorStep("trapez");
      return;
    }
    if (editorStep === "trapez") {
      void confirmCrop();
      return;
    }
    if (previewFile) {
      onConfirm(previewFile);
    }
  }

  return (
    <div className="popup-overlay smart-editor-overlay">
      <div className="popup-card smart-editor-modal" role="dialog" aria-modal="true" aria-label="Bildkorrektur-Editor">
        <div className="smart-editor-header">
          <div>
            <h3>{t.dashboard.editorTitle}</h3>
            <p><strong>{stepTitle}</strong> · {stepDescription}</p>
          </div>
          <div className="smart-editor-header-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
              {t.common.cancel}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handlePrimaryStep}>
              {editorStep === "preview" ? t.common.ok : t.dashboard.editorNext}
            </button>
          </div>
        </div>

        <div className="smart-editor-stage" ref={stageRef}>
          {editorStep === "preview" && previewUrl ? (
            <img
              src={previewUrl}
              alt={t.dashboard.editorPreviewAlt}
              style={{
                left: "50%",
                top: "50%",
                width: "auto",
                height: "100%",
                maxWidth: "100%",
                transform: "translate(-50%, -50%)",
                filter: "none"
              }}
              draggable={false}
            />
          ) : imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt={t.dashboard.editorUploadAlt}
                style={{
                  left: "50%",
                  top: "50%",
                  width: imageRect.width * zoom,
                  height: imageRect.height * zoom,
                  transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) rotate(${rotation}deg)`,
                  filter: `brightness(${brightness}%) contrast(${contrast}%) ${isBW ? "grayscale(100%)" : "grayscale(0%)"}`
                }}
                onPointerDown={startPan}
                draggable={false}
              />
              {editorStep === "rotate" ? (
                <>
                  <div className="smart-editor-center-guide" />
                  <div className="smart-editor-rotate-badge" aria-hidden="true">↻</div>
                  <svg className="smart-editor-overlay-lines" viewBox={`0 0 ${stageSize.x} ${stageSize.y}`} aria-hidden="true">
                    <line x1={center.x} y1={center.y} x2={rotateHandle.x} y2={rotateHandle.y} className="smart-editor-rotate-line" />
                  </svg>
                  <button
                    type="button"
                    className="smart-editor-rotate-handle"
                    style={{ left: rotateHandle.x, top: rotateHandle.y }}
                    onPointerDown={startRotate}
                    title={t.dashboard.editorRotateTitle}
                  />
                </>
              ) : null}
              {editorStep === "trapez" ? (
                <>
                  <svg className="smart-editor-overlay-lines" viewBox={`0 0 ${stageSize.x} ${stageSize.y}`} aria-hidden="true">
                    <polygon points={polygon} />
                    {pointsStage.map((point, index) => (
                      <circle key={index} cx={point.x} cy={point.y} r="8" />
                    ))}
                  </svg>
                  {pointsStage.map((point, index) => (
                    <button
                      key={index}
                      type="button"
                      className="smart-editor-point"
                      style={{ left: point.x, top: point.y }}
                      onPointerDown={(event) => startDrag(index, event)}
                      title={txt(t.dashboard.editorCornerTitle, { index: String(index + 1) })}
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <span>{t.dashboard.editorLoading}</span>
          )}
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}
        {editorStep !== "preview" ? <div className="smart-editor-tools">
          <button
            type="button"
            className="smart-editor-icon-btn"
            onClick={() => setZoom((v) => Math.min(3, Number((v + 0.15).toFixed(2))))}
            title={t.dashboard.editorZoomIn}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5 21 21M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="smart-editor-icon-btn"
            onClick={() => setZoom((v) => Math.max(0.5, Number((v - 0.15).toFixed(2))))}
            title={t.dashboard.editorZoomOut}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5 21 21M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className={`btn btn-outline btn-sm ${isBW ? "active" : ""}`} onClick={() => setIsBW((v) => !v)}>
            SW
          </button>
          <div className="smart-editor-slider">
            <label htmlFor="editorBrightness">{t.dashboard.editorBrightness}</label>
            <input
              id="editorBrightness"
              type="range"
              min={70}
              max={140}
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
            />
          </div>
          <div className="smart-editor-slider">
            <label htmlFor="editorContrast">{t.dashboard.editorContrast}</label>
            <input
              id="editorContrast"
              type="range"
              min={70}
              max={150}
              value={contrast}
              onChange={(event) => setContrast(Number(event.target.value))}
            />
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setRotation(0);
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setBrightness(100);
              setContrast(100);
              setIsBW(false);
              const defaults = defaultEditorPoints(stageSize, imageSize);
              setPoints(defaults.map((p) => stageToLocalPoint(p, stageSize, { x: 0, y: 0 }, 0)));
            }}
          >
            {t.dashboard.editorReset}
          </button>
        </div> : null}
        <div className="smart-editor-actions">
          {editorStep !== "rotate" ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                if (editorStep === "preview") {
                  setEditorStep("trapez");
                  return;
                }
                setEditorStep("rotate");
              }}
            >
              {t.dashboard.editorBack}
            </button>
          ) : null}
          {error ? (
            <button type="button" className="btn btn-outline" onClick={() => onConfirm(file)}>
              {t.dashboard.editorUseOriginal}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
