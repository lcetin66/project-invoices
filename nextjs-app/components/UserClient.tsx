// Project owner: Levent Cetin
"use client";

import { FormEvent, useEffect, useState } from "react";
import type { UserProfile } from "@/lib/types";
import { t, txt } from "@/lang";
import type { LocaleCode } from "@/lang";
import { useLanguage } from "@/components/LanguageProvider";

type AiOption = { label: string; provider: string; model: string };

const emptyProfile: UserProfile = {
  username: "admin",
  first_name: "",
  last_name: "",
  company_name: "",
  company_address: "",
  city: "",
  postal_code: "",
  country: "",
  tax_number: "",
  vat_id: ""
};

export function UserClient() {
  const { locale, setLanguage } = useLanguage();
  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [aiOptions, setAiOptions] = useState<Record<string, AiOption>>({});
  const [aiService, setAiService] = useState("openrouter_openai");
  const [aiKey, setAiKey] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const languageOptions: Array<{ value: LocaleCode; label: string }> = [
    { value: "de", label: t.user.languageGerman },
    { value: "tr", label: t.user.languageTurkish },
    { value: "en", label: t.user.languageEnglish }
  ];

  async function loadData(): Promise<void> {
    const res = await fetch("/api/user-profile", { cache: "no-store" });
    const data = (await res.json()) as {
      ok?: boolean;
      profile?: UserProfile;
      ai?: { ai_service?: string; ai_api_key?: string; masked_api_key?: string };
      options?: Record<string, AiOption>;
    };
    if (!res.ok || !data.ok) return;
    setProfile(data.profile ?? emptyProfile);
    setAiService(data.ai?.ai_service ?? "openrouter_openai");
    setAiKey(data.ai?.ai_api_key ?? "");
    setAiOptions(data.options ?? {});
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function saveAll(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const res = await fetch("/api/user-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        service: aiService,
        apiKey: aiKey
      })
    });
    const data = (await res.json()) as { ok?: boolean; message?: string; ai?: { ai_api_key?: string; masked_api_key?: string } };
    setStatus({ ok: Boolean(data.ok), text: data.message ?? t.user.saved });
    if (data.ai?.ai_api_key) setAiKey(data.ai.ai_api_key);
    setShowAiKey(false);
    await loadData();
  }

  async function copyKey(): Promise<void> {
    const value = aiKey.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus({ ok: true, text: t.common.copy });
    } catch {
      setStatus({ ok: false, text: "Kopieren fehlgeschlagen." });
    }
  }

  return (
    <section className="user-profile-page">
      {status ? (
        <div className="popup-overlay">
          <div className="popup-card">
            <h3>{status.ok ? t.common.success : t.common.warning}</h3>
            <p>{status.text}</p>
            <button type="button" className="btn btn-primary" onClick={() => setStatus(null)}>
              {t.common.ok}
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-card user-card">
        <h3>{t.user.title}</h3>
        <form className="kat-form user-form" onSubmit={(event) => void saveAll(event)}>
          <div className="user-profile-grid">
            <div className="form-group">
              <label>{t.user.username}</label>
              <input value={profile.username} onChange={(e) => setProfile((p) => ({ ...p, username: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.firstName}</label>
              <input value={profile.first_name} onChange={(e) => setProfile((p) => ({ ...p, first_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.lastName}</label>
              <input value={profile.last_name} onChange={(e) => setProfile((p) => ({ ...p, last_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.company}</label>
              <input value={profile.company_name} onChange={(e) => setProfile((p) => ({ ...p, company_name: e.target.value }))} />
            </div>
            <div className="form-group user-span-2">
              <label>{t.user.address}</label>
              <input value={profile.company_address} onChange={(e) => setProfile((p) => ({ ...p, company_address: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.city}</label>
              <input value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.postalCode}</label>
              <input value={profile.postal_code} onChange={(e) => setProfile((p) => ({ ...p, postal_code: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.country}</label>
              <input value={profile.country} onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>{t.user.taxNumber}</label>
              <input value={profile.tax_number} onChange={(e) => setProfile((p) => ({ ...p, tax_number: e.target.value }))} />
            </div>
            <div className="form-group user-vat-field">
              <label>{t.user.vatId}</label>
              <input value={profile.vat_id} onChange={(e) => setProfile((p) => ({ ...p, vat_id: e.target.value }))} />
            </div>
          </div>

          <div className="user-settings-grid">
            <div className="user-settings-column">
              <h3 className="user-section-title">{t.user.language}</h3>
              <div className="form-group">
                <label>{t.user.language}</label>
                <select value={locale} onChange={(e) => setLanguage(e.target.value as LocaleCode)}>
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="user-settings-column">
              <h3 className="user-section-title">{t.user.apiSettings}</h3>
              <div className="form-group">
                <label>{t.user.aiService}</label>
                <select value={aiService} onChange={(e) => setAiService(e.target.value)}>
                  {Object.entries(aiOptions).map(([key, option]) => (
                    <option key={key} value={key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t.user.apiKey}</label>
                <div className="password-input-wrap user-key-row">
                  <input
                    type={showAiKey ? "text" : "password"}
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    placeholder="sk-... / sk-or-v1-..."
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    title={showAiKey ? "Ausblenden" : "Anzeigen"}
                    aria-label={showAiKey ? "API key ausblenden" : "API key anzeigen"}
                    onClick={() => setShowAiKey((prev) => !prev)}
                  >
                    {showAiKey ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.7-1.67 1.81-3.19 3.22-4.44M9.9 4.24A11.3 11.3 0 0 1 12 4c5 0 9.27 3.89 11 8-.5 1.2-1.18 2.31-2.01 3.3" />
                        <path d="M1 1l22 22" />
                        <path d="M9.88 9.88A3 3 0 0 0 14.12 14.12" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn-icon user-copy-btn"
                    title="Kopieren"
                    aria-label="API key kopieren"
                    onClick={() => void copyKey()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="user-save-wrap">
                <button className="btn btn-primary user-save-btn" type="submit">
                  {t.common.save}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
