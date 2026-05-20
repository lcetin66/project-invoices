/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useMemo, useState } from "react";
import { t } from "@/lang";

type DebugApiResponse = {
  ok?: boolean;
  message?: string;
  sent_json?: unknown;
  response_json?: unknown;
  openai_trace?: unknown;
};

export function JsonDebugClient() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentJson, setSentJson] = useState<unknown>(null);
  const [responseJson, setResponseJson] = useState<unknown>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  
  async function copyJson(value: unknown): Promise<void> {
    const text = JSON.stringify(value ?? null, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setSentJson(null);
    setResponseJson(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/debug-json", { method: "POST", body: formData });
      const data = (await res.json()) as DebugApiResponse;
      if (!res.ok || !data.ok) {
        setError(data.message ?? t.debugJson.failed);
        return;
      }
      setSentJson(data.sent_json ?? null);
      setResponseJson(data.response_json ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.debugJson.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="json-debug-page">
      <form className="json-debug-toolbar" onSubmit={(event) => void onSubmit(event)}>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.tif,.tiff,.webp,.heic,.heif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={!file || loading}>
          {loading ? t.debugJson.running : t.debugJson.run}
        </button>
      </form>
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="json-debug-grid">
        <div className="json-debug-left">
          {previewUrl ? <img src={previewUrl} alt={t.debugJson.preview} className="json-debug-image" /> : <p>{t.debugJson.preview}</p>}
        </div>
        <div className="json-debug-right">
          <div className="json-panel">
            <div className="json-panel-head">
              <h3>{t.debugJson.sent}</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyJson(sentJson)}>{t.common.copy}</button>
            </div>
            <pre>{JSON.stringify(sentJson, null, 2)}</pre>
          </div>
          <div className="json-panel">
            <div className="json-panel-head">
              <h3>{t.debugJson.received}</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyJson(responseJson)}>{t.common.copy}</button>
            </div>
            <pre>{JSON.stringify(responseJson, null, 2)}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}
