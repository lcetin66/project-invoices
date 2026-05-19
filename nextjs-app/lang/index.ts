import { de } from "@/lang/de";
import { tr } from "@/lang/tr";

const locale = (process.env.NEXT_PUBLIC_APP_LANG || "de").toLowerCase();

export const t = locale.startsWith("tr") ? tr : de;

export function txt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}
