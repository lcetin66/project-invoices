/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useMemo, useState } from "react";

type DebugApiResponse = {
  ok?: boolean;
  message?: string;
  sent_json?: unknown;
  response_json?: unknown;
};

export function JsonDebugClient() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentJson, setSentJson] = useState<unknown>(null);
  const [responseJson, setResponseJson] = useState<unknown>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);

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
        setError(data.message ?? "Debug request failed.");
        return;
      }
      setSentJson(data.sent_json ?? null);
      setResponseJson(data.response_json ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Debug request failed.");
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
          {loading ? "Läuft..." : "Debug Çalıştır"}
        </button>
      </form>
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="json-debug-grid">
        <div className="json-debug-left">
          {previewUrl ? <img src={previewUrl} alt="input" className="json-debug-image" /> : <p>Image Preview</p>}
        </div>
        <div className="json-debug-right">
          <div className="json-panel">
            <h3>Giden JSON</h3>
            <pre>{JSON.stringify(sentJson, null, 2)}</pre>
          </div>
          <div className="json-panel">
            <h3>Dönen JSON</h3>
            <pre>{JSON.stringify(responseJson, null, 2)}</pre>
          </div>
          <div className="json-panel">
            <h3>Wichtige Felder (Schnellansicht)</h3>
            <pre>
              {JSON.stringify(
                (() => {
                  const r = (responseJson as { ergebnis?: Record<string, unknown> } | null)?.ergebnis ?? {};
                  return {
                    lieferant: r.lieferant ?? "",
                    kategorie: r.kategorie ?? "",
                    brutto_betrag: r.brutto_betrag ?? "",
                    netto_betrag: r.netto_betrag ?? "",
                    mwst_satz: r.mwst_satz ?? "",
                    mwst_betrag: r.mwst_betrag ?? "",
                    zahlungsart: r.zahlungsart ?? "",
                    zahlungsmittel: r.zahlungsmittel ?? "",
                    belegnummer: r.belegnummer ?? "",
                    rechnungsnummer: r.rechnungsnummer ?? "",
                    kundennummer: r.kundennummer ?? "",
                    steuer_id: r.steuer_id ?? "",
                    iban_maskiert: r.iban_maskiert ?? "",
                    faelligkeitsdatum: r.faelligkeitsdatum ?? ""
                  };
                })(),
                null,
                2
              )}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
