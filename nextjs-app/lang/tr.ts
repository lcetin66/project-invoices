import { de, type LocaleDict } from "@/lang/de";

// Gewünscht: Die Türkisch-Option soll aktuell 1:1 Deutsch anzeigen.
// So bleiben alle Schlüssel vollständig und identisch.
export const tr: LocaleDict = JSON.parse(JSON.stringify(de)) as LocaleDict;
