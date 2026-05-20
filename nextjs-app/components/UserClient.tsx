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
  const [maskedKey, setMaskedKey] = useState<string>(t.user.notSet);
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
      ai?: { ai_service?: string; masked_api_key?: string };
      options?: Record<string, AiOption>;
    };
    if (!res.ok || !data.ok) return;
    setProfile(data.profile ?? emptyProfile);
    setAiService(data.ai?.ai_service ?? "openrouter_openai");
    setMaskedKey(data.ai?.masked_api_key ?? t.user.notSet);
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
    const data = (await res.json()) as { ok?: boolean; message?: string; ai?: { masked_api_key?: string } };
    setStatus({ ok: Boolean(data.ok), text: data.message ?? t.user.saved });
    if (data.ai?.masked_api_key) setMaskedKey(data.ai.masked_api_key);
    setAiKey("");
    await loadData();
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

      <div className="admin-card">
        <h3>{t.user.title}</h3>
        <form className="kat-form" onSubmit={(event) => void saveAll(event)}>
          <div className="user-grid">
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
            <div className="form-group user-col-span-2">
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
            <div className="form-group">
              <label>{t.user.vatId}</label>
              <input value={profile.vat_id} onChange={(e) => setProfile((p) => ({ ...p, vat_id: e.target.value }))} />
            </div>
          </div>

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

          <h3 className="user-section-title">{t.user.apiSettings}</h3>
          <div className="api-key-hint">{txt(t.user.current, { key: maskedKey })}</div>
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
            <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-... / sk-or-v1-..." />
          </div>
          <button className="btn btn-primary" type="submit">
            {t.common.save}
          </button>
        </form>
      </div>
    </section>
  );
}
