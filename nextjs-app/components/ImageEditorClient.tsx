"use client";

import type { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type Point = {
  x: number;
  y: number;
};

type DragState =
  | { type: "point"; index: number }
  | { type: "rotate"; startAngle: number; startRotation: number }
  | null;

type EditorTool = "zoom" | "trapezoid" | "rotate";

type EditorClassifyResponse = {
  ok?: boolean;
  message?: string;
  ergebnis?: Record<string, unknown>;
  qualitaet_score?: number;
};

const MAX_OUTPUT_EDGE = 2200;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPointerPoint(event: PointerEvent | ReactPointerEvent, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function getFitSize(stage: Point, image: Point): Point {
  if (!image.x || !image.y) return { x: 0, y: 0 };
  const scale = Math.min((stage.x * 0.78) / image.x, (stage.y * 0.78) / image.y, 1);
  return {
    x: image.x * scale,
    y: image.y * scale
  };
}

function createDefaultPoints(stage: Point, imageSize: Point): Point[] {
  const fit = getFitSize(stage, imageSize);
  const left = (stage.x - fit.x) / 2;
  const top = (stage.y - fit.y) / 2;
  const insetX = Math.max(18, fit.x * 0.05);
  const insetY = Math.max(18, fit.y * 0.05);

  return [
    { x: left + insetX, y: top + insetY },
    { x: left + fit.x - insetX, y: top + insetY },
    { x: left + fit.x - insetX, y: top + fit.y - insetY },
    { x: left + insetX, y: top + fit.y - insetY }
  ];
}

function sampleBilinear(source: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number, number] {
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

export function ImageEditorClient() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const outputRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<Point>({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState<Point>({ x: 860, y: 560 });
  const [points, setPoints] = useState<Point[]>([]);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState<EditorTool>("trapezoid");
  const [dragOver, setDragOver] = useState(false);
  const [usingResult, setUsingResult] = useState(false);
  const [status, setStatus] = useState("Resim yukleyin, sonra cemberi ve kose noktalarini surukleyin.");

  const fitSize = useMemo(() => getFitSize(stageSize, imageSize), [stageSize, imageSize]);
  const imageStyle = {
    width: `${fitSize.x * zoom}px`,
    height: `${fitSize.y * zoom}px`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`
  };
  const polygon = points.map((point) => `${point.x},${point.y}`).join(" ");
  const center = { x: stageSize.x / 2, y: stageSize.y / 2 };
  const rotateHandle = {
    x: center.x + Math.sin((rotation * Math.PI) / 180) * -120,
    y: center.y + Math.cos((rotation * Math.PI) / 180) * -120
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setStageSize({ x: box.width, y: box.height });
    });

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (imageSize.x && imageSize.y) {
      setPoints(createDefaultPoints({ x: stageSize.x, y: stageSize.y }, imageSize));
    }
  }, [imageSize, stageSize.x, stageSize.y]);

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const stage = stageRef.current;
      if (!stage || !dragRef.current) return;
      const pointer = getPointerPoint(event, stage);

      if (dragRef.current.type === "point") {
        const index = dragRef.current.index;
        setPoints((current) =>
          current.map((point, pointIndex) =>
            pointIndex === index
              ? {
                  x: clamp(pointer.x, 0, stageSize.x),
                  y: clamp(pointer.y, 0, stageSize.y)
                }
              : point
          )
        );
        return;
      }

      const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI);
      setRotation(dragRef.current.startRotation + angle - dragRef.current.startAngle);
    }

    function handleUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [center.x, center.y, stageSize.x, stageSize.y]);

  function loadImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setStatus("Lutfen bir resim dosyasi birakin.");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageRef.current = image;
      setImageUrl(url);
      setImageSize({ x: image.naturalWidth, y: image.naturalHeight });
      setRotation(0);
      setZoom(1);
      setActiveTool("trapezoid");
      setStatus("Resim hazir. Buyuk cemberle dondurun, noktalari belge koselerine tasiyin.");
      if (outputRef.current) {
        outputRef.current.width = 0;
        outputRef.current.height = 0;
        outputRef.current.dataset.ready = "0";
      }
    };
    image.src = url;
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    loadImage(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (!file) {
      setStatus("Suruklenen dosyalar arasinda resim bulunamadi.");
      return;
    }
    loadImage(file);
  }

  function startPointDrag(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragRef.current = { type: "point", index };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startRotate(event: ReactPointerEvent<HTMLButtonElement>) {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = getPointerPoint(event, stage);
    dragRef.current = {
      type: "rotate",
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI),
      startRotation: rotation
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resetSelection() {
    setRotation(0);
    setZoom(1);
    setActiveTool("trapezoid");
    setPoints(createDefaultPoints(stageSize, imageSize));
    if (outputRef.current) {
      outputRef.current.width = 0;
      outputRef.current.height = 0;
      outputRef.current.dataset.ready = "0";
    }
    setStatus("Secim sifirlandi.");
  }

  function handleZoomTool() {
    setActiveTool("zoom");
    setZoom((current) => {
      const next = current >= 1.7 ? 1 : Number((current + 0.35).toFixed(2));
      setStatus(next === 1 ? "Zoom sifirlandi." : `Zoom ${Math.round(next * 100)}%.`);
      return next;
    });
  }

  function renderStageCanvas(outputScale = 1): HTMLCanvasElement | null {
    const image = imageRef.current;
    if (!image || !fitSize.x || !fitSize.y) return null;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(stageSize.x * outputScale));
    canvas.height = Math.max(1, Math.round(stageSize.y * outputScale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.scale(outputScale, outputScale);
    context.translate(stageSize.x / 2, stageSize.y / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(image, -(fitSize.x * zoom) / 2, -(fitSize.y * zoom) / 2, fitSize.x * zoom, fitSize.y * zoom);
    context.restore();

    return canvas;
  }

  function applyCrop(): boolean {
    if (points.length !== 4) return false;
    const qualityScale = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const sourceCanvas = renderStageCanvas(qualityScale);
    const outputCanvas = outputRef.current;
    if (!sourceCanvas || !outputCanvas) return false;

    const [topLeft, topRight, bottomRight, bottomLeft] = points.map((point) => ({
      x: point.x * qualityScale,
      y: point.y * qualityScale
    }));
    const rawWidth = Math.max(60, Math.round((distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2));
    const rawHeight = Math.max(60, Math.round((distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2));
    const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(rawWidth, rawHeight));
    const outWidth = Math.round(rawWidth * scale);
    const outHeight = Math.round(rawHeight * scale);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const outputContext = outputCanvas.getContext("2d");
    if (!sourceContext || !outputContext) return false;

    const sourceImage = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const result = outputContext.createImageData(outWidth, outHeight);

    for (let y = 0; y < outHeight; y += 1) {
      const v = outHeight === 1 ? 0 : y / (outHeight - 1);
      for (let x = 0; x < outWidth; x += 1) {
        const u = outWidth === 1 ? 0 : x / (outWidth - 1);
        const sourceX =
          topLeft.x * (1 - u) * (1 - v) +
          topRight.x * u * (1 - v) +
          bottomRight.x * u * v +
          bottomLeft.x * (1 - u) * v;
        const sourceY =
          topLeft.y * (1 - u) * (1 - v) +
          topRight.y * u * (1 - v) +
          bottomRight.y * u * v +
          bottomLeft.y * (1 - u) * v;
        const pixel = sampleBilinear(sourceImage.data, sourceCanvas.width, sourceCanvas.height, sourceX, sourceY);
        const targetIndex = (y * outWidth + x) * 4;
        result.data[targetIndex] = pixel[0];
        result.data[targetIndex + 1] = pixel[1];
        result.data[targetIndex + 2] = pixel[2];
        result.data[targetIndex + 3] = pixel[3];
      }
    }

    outputCanvas.width = outWidth;
    outputCanvas.height = outHeight;
    outputContext.putImageData(result, 0, 0);
    outputCanvas.dataset.ready = "1";
    setStatus("Trapez secim dikdortgen ciktiya donusturuldu.");
    return true;
  }

  function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png", 0.96));
  }

  async function useCorrectedImage() {
    const outputCanvas = outputRef.current;
    if (!outputCanvas || !imageUrl) return;
    setUsingResult(true);
    setStatus("Duzeltilmis resim hazirlaniyor...");

    try {
      if (outputCanvas.dataset.ready !== "1") {
        const ok = applyCrop();
        if (!ok) throw new Error("Resim duzeltilemedi.");
      }

      const blob = await canvasToBlob(outputCanvas);
      if (!blob) throw new Error("Duzeltilmis resim olusturulamadi.");

      const formData = new FormData();
      formData.append("file", new File([blob], "duzeltilmis-resim.png", { type: "image/png" }));
      formData.append("rechnung_typ", "eingang");
      formData.append("beschreibung", "Resim editorunde trapez duzeltme uygulandi.");

      setStatus("AI isleme gonderiliyor...");
      const response = await fetch("/api/editor-classify", {
        method: "POST",
        body: formData
      });
      const data = (await response.json().catch(() => ({}))) as EditorClassifyResponse;
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || "AI isleme basarisiz oldu.");
      }

      const supplier = String(data.ergebnis?.lieferant ?? data.ergebnis?.vendor ?? "Bilinmiyor");
      const total = String(data.ergebnis?.brutto_betrag ?? data.ergebnis?.gesamt_betrag ?? data.ergebnis?.total ?? "-");
      setStatus(`AI sonuc: ${supplier} | ${total} | kalite ${Number(data.qualitaet_score ?? 0)}%`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI isleme basarisiz oldu.");
    } finally {
      setUsingResult(false);
    }
  }

  return (
    <section className="image-editor">
      <div className="editor-toolbar">
        <label className="editor-upload">
          <input type="file" accept="image/*" onChange={handleFileChange} />
          <span>Resim yukle</span>
        </label>
        <button type="button" className="btn btn-outline" onClick={resetSelection} disabled={!imageUrl}>
          Sifirla
        </button>
        <button type="button" className="btn btn-primary" onClick={applyCrop} disabled={!imageUrl}>
          Duzelt
        </button>
        <span className="editor-status">{status}</span>
      </div>

      <div className="editor-workspace">
        <div
          className={`editor-stage ${dragOver ? "dragover" : ""}`}
          ref={stageRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="editor-toolbox" aria-label="Editor araclari">
            <button
              type="button"
              className={`editor-tool ${activeTool === "zoom" ? "active" : ""}`}
              onClick={handleZoomTool}
              disabled={!imageUrl}
              title="Buyultec"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5 21 21M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className={`editor-tool ${activeTool === "trapezoid" ? "active" : ""}`}
              onClick={() => {
                setActiveTool("trapezoid");
                setStatus("Trapez araci aktif. Noktalari belge koselerine surukleyin.");
              }}
              disabled={!imageUrl}
              title="Trapez"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 5h12l3 14H3L6 5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="6" cy="5" r="1.5" fill="currentColor" />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
                <circle cx="21" cy="19" r="1.5" fill="currentColor" />
                <circle cx="3" cy="19" r="1.5" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className={`editor-tool ${activeTool === "rotate" ? "active" : ""}`}
              onClick={() => {
                setActiveTool("rotate");
                setStatus("Cevir araci aktif. Buyuk cemberi surukleyin.");
              }}
              disabled={!imageUrl}
              title="Cevir"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M17 2v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 12a7 7 0 1 1-2.05-4.95L17 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="editor-image" src={imageUrl} alt="Yuklenen resim" style={imageStyle} draggable={false} />
              <svg className="crop-overlay" viewBox={`0 0 ${stageSize.x} ${stageSize.y}`} aria-hidden="true">
                <polygon points={polygon} />
                {points.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r="8" />
                ))}
                <line x1={center.x} y1={center.y} x2={rotateHandle.x} y2={rotateHandle.y} className="rotate-line" />
              </svg>
              <button
                type="button"
                className={`rotate-handle ${activeTool === "rotate" ? "active" : ""}`}
                style={{ left: rotateHandle.x, top: rotateHandle.y }}
                onPointerDown={startRotate}
                title="Dondur"
              >
                <svg width="70" height="70" viewBox="0 0 70 70" fill="none" aria-hidden="true">
                  <path d="M52 20A24 24 0 1 0 58 38" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                  <path d="M52 20H40M52 20V8" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </button>
              {points.map((point, index) => (
                <button
                  key={index}
                  type="button"
                  className="crop-point"
                  style={{ left: point.x, top: point.y }}
                  onPointerDown={(event) => startPointDrag(index, event)}
                  title={`Kose ${index + 1}`}
                />
              ))}
            </>
          ) : (
            <div className="editor-empty">
              <strong>Resim bekleniyor</strong>
              <span>Dosyayi buraya birakin veya yukleme dugmesini kullanin.</span>
            </div>
          )}
        </div>

        <aside className="editor-result">
          <div className="editor-result-header">
            <div>
              <strong>Sonuc</strong>
              <span>Duzeltilmis dikdortgen onizleme</span>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={useCorrectedImage} disabled={!imageUrl || usingResult}>
              {usingResult ? "Gonderiliyor..." : "Kullan"}
            </button>
          </div>
          <canvas ref={outputRef} />
        </aside>
      </div>
    </section>
  );
}
