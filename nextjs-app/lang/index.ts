import { de } from "@/lang/de";
import { en } from "@/lang/en";
import { tr } from "@/lang/tr";

export type LocaleCode = "de" | "tr" | "en";

const dictionaries = { de, tr, en } as const;

export function normalizeLocale(value: string | null | undefined): LocaleCode {
  const locale = String(value ?? "").toLowerCase();
  if (locale.startsWith("tr")) return "tr";
  if (locale.startsWith("en")) return "en";
  return "de";
}

let activeLocale = normalizeLocale(process.env.NEXT_PUBLIC_APP_LANG || "de");

export function setActiveLocale(locale: string): LocaleCode {
  activeLocale = normalizeLocale(locale);
  return activeLocale;
}

export function getActiveLocale(): LocaleCode {
  return activeLocale;
}

export function getDictionary(locale: string = activeLocale) {
  return dictionaries[normalizeLocale(locale)];
}

export const t = new Proxy({} as typeof de, {
  get(_target, prop: keyof typeof de) {
    return getDictionary()[prop];
  }
});

export function txt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}
