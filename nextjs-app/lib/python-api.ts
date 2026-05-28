import type { AiSettings } from "@/lib/types";

function getApiBase(): string {
  const raw = (process.env.CLASSIFIER_API_URL ?? "http://127.0.0.1:8000").trim();
  if (raw.endsWith("/api/klassifizieren")) {
    return raw.replace(/\/api\/klassifizieren\/?$/, "");
  }
  return raw.replace(/\/$/, "");
}

export interface ClassifierResponse {
  erfolgreich: boolean;
  datei_name: string;
  ergebnis: Record<string, unknown>;
  qualitaet_score: number;
  debug?: {
    ocr_text_len?: number;
    ocr_text_preview?: string;
    mode?: string;
    vision_debug?: string;
    vision_trace?: {
      timings_ms?: {
        total_ms?: number;
        main_call_ms?: number;
        tax_call_ms?: number;
        main_retry_call_ms?: number;
      };
      main_retry_used?: boolean;
      image_payload?: {
        source_mime?: string;
        source_size_bytes?: number;
        source_width?: number;
        source_height?: number;
        sent_mime?: string;
        sent_size_bytes?: number;
        sent_width?: number;
        sent_height?: number;
        chunk_count?: number;
      };
    };
  };
}

export class ClassifierApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.name = "ClassifierApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function normalizeModel(model: string | null | undefined, provider: string | null | undefined): string {
  const raw = String(model ?? "").trim();
  const p = String(provider ?? "openrouter").trim().toLowerCase();
  if (!raw) {
    return p === "openai" ? "gpt-4o-mini" : "openai/gpt-4o-mini";
  }
  return raw;
}

export async function classifyWithPython(file: File, ai: AiSettings): Promise<ClassifierResponse> {
  const form = new FormData();
  form.append("datei", file, file.name);
  form.append("api_key", ai.ai_api_key ?? "");
  form.append("api_provider", ai.ai_provider ?? "openrouter");
  form.append("api_model", normalizeModel(ai.ai_model, ai.ai_provider));

  const response = await fetch(`${getApiBase()}/api/klassifizieren`, {
    method: "POST",
    body: form,
    cache: "no-store"
  });

  const data = (await response.json()) as Partial<ClassifierResponse> & Record<string, unknown>;

  if (!response.ok) {
    const message = String(data.message ?? `Classifier API error (${response.status})`);
    throw new ClassifierApiError(message, response.status, data);
  }
  if (!data.erfolgreich || !data.datei_name || !data.ergebnis) {
    throw new Error("Classifier API returned incomplete payload");
  }

  return {
    erfolgreich: true,
    datei_name: data.datei_name,
    ergebnis: data.ergebnis,
    qualitaet_score: Number(data.qualitaet_score ?? 0),
    debug: data.debug
  };
}

export async function requestBusinessInsights(stats: Record<string, unknown>, ai: AiSettings): Promise<string[]> {
  const response = await fetch(`${getApiBase()}/api/business_insights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stats,
      api_key: ai.ai_api_key ?? "",
      api_provider: ai.ai_provider ?? "openrouter",
      api_model: normalizeModel(ai.ai_model, ai.ai_provider)
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { insights?: unknown };
  if (!Array.isArray(data.insights)) {
    return [];
  }

  return data.insights.filter((item): item is string => typeof item === "string").slice(0, 4);
}

export async function deletePythonUpload(name: string): Promise<void> {
  try {
    await fetch(`${getApiBase()}/api/datei-loeschen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
  } catch {
    // Best effort: local DB deletion should still proceed even if API cleanup fails.
  }
}
