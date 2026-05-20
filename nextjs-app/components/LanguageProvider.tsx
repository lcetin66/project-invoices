"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { getActiveLocale, LocaleCode, normalizeLocale, setActiveLocale } from "@/lang";

type LanguageContextValue = {
  locale: LocaleCode;
  setLanguage: (locale: LocaleCode) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "rechnung_app_lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<LocaleCode>(() => getActiveLocale());

  useEffect(() => {
    const stored = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
    if (stored !== locale) {
      setActiveLocale(stored);
      setLocale(stored);
    }
  }, [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLanguage: (nextLocale) => {
        const normalized = normalizeLocale(nextLocale);
        window.localStorage.setItem(STORAGE_KEY, normalized);
        document.cookie = `${STORAGE_KEY}=${normalized}; path=/; max-age=31536000; SameSite=Lax`;
        setActiveLocale(normalized);
        setLocale(normalized);
      }
    }),
    [locale]
  );

  return (
    <LanguageContext.Provider value={value}>
      <div key={locale}>{children}</div>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return context;
}
