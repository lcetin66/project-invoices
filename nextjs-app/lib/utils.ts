// Project owner: Levent Cetin
import path from "node:path";
import fs from "node:fs/promises";

export function sanitizeFilename(originalName: string): string {
  const base = path.basename(originalName || "datei");
  const ext = path.extname(base).replace(/[^A-Za-z0-9.]+/g, "").toLowerCase();
  const stem = path
    .basename(base, path.extname(base))
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  const safeStem = stem || "datei";
  const safeExt = ext.length <= 10 ? ext : "";
  return `${safeStem}${safeExt}`;
}

export function parseInvoiceType(raw: string | null): "eingang" | "ausgang" {
  return raw === "ausgang" ? "ausgang" : "eingang";
}

export function getUploadAbsoluteDir(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "../uploads");
}

export async function ensureUploadDir(): Promise<string> {
  const dir = getUploadAbsoluteDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function isValidMysqlDate(input: string | null | undefined): boolean {
  if (!input) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

export function parseFloatOrNull(input: FormDataEntryValue | null): number | null {
  if (input == null) return null;
  const value = Number(String(input).replace(",", "."));
  if (Number.isNaN(value)) return null;
  return value;
}

export function toNullableString(input: FormDataEntryValue | null): string | null {
  if (input == null) return null;
  const value = String(input).trim();
  return value === "" ? null : value;
}
