import type { RowDataPacket } from "mysql2/promise";
import { AI_OPTIONS } from "@/lib/constants";
import { execute, getAppSetting, queryRows, setAppSetting } from "@/lib/db";
import type { AiSettings, Category, Invoice, UserProfile } from "@/lib/types";

function aiServiceOrDefault(value: string): keyof typeof AI_OPTIONS {
  if (value in AI_OPTIONS) {
    return value as keyof typeof AI_OPTIONS;
  }
  return "openrouter_openai";
}

export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return "Nicht gesetzt";
  if (key.length <= 10) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export async function getAiSettings(): Promise<AiSettings> {
  const service = aiServiceOrDefault(await getAppSetting("ai_service", "openrouter_openai"));
  const option = AI_OPTIONS[service];
  const optionProvider = String(option.provider);
  const optionModel = String(option.model);

  const storedProvider = String(await getAppSetting("ai_provider", optionProvider));
  const storedModel = String(await getAppSetting("ai_model", optionModel));
  const apiKey = await getAppSetting("ai_api_key", await getAppSetting("openrouter_api_key", ""));
  const shouldRepairStoredAi =
    storedProvider !== optionProvider ||
    storedModel !== optionModel;

  if (shouldRepairStoredAi) {
    await setAppSetting("ai_provider", optionProvider);
    await setAppSetting("ai_model", optionModel);
  }

  return {
    ai_service: service,
    ai_provider: optionProvider,
    ai_model: optionModel,
    ai_api_key: apiKey
  };
}

export async function saveAiSettings(serviceInput: string, apiKey: string): Promise<AiSettings> {
  const service = aiServiceOrDefault(serviceInput);
  const option = AI_OPTIONS[service];
  const existingApiKey = await getAppSetting("ai_api_key", await getAppSetting("openrouter_api_key", ""));
  const keyToSave = apiKey.trim() || existingApiKey;

  await setAppSetting("ai_service", service);
  await setAppSetting("ai_provider", option.provider);
  await setAppSetting("ai_model", option.model);
  await setAppSetting("ai_api_key", keyToSave);
  await setAppSetting("openrouter_api_key", keyToSave);

  return {
    ai_service: service,
    ai_provider: option.provider,
    ai_model: option.model,
    ai_api_key: keyToSave
  };
}

export async function getUserProfile(defaultUsername = "admin"): Promise<UserProfile> {
  return {
    username: await getAppSetting("profile_username", defaultUsername),
    first_name: await getAppSetting("profile_first_name", ""),
    last_name: await getAppSetting("profile_last_name", ""),
    company_name: await getAppSetting("profile_company_name", ""),
    company_address: await getAppSetting("profile_company_address", ""),
    city: await getAppSetting("profile_city", ""),
    postal_code: await getAppSetting("profile_postal_code", ""),
    country: await getAppSetting("profile_country", ""),
    tax_number: await getAppSetting("profile_tax_number", ""),
    vat_id: await getAppSetting("profile_vat_id", "")
  };
}

export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  await setAppSetting("profile_username", profile.username || "admin");
  await setAppSetting("profile_first_name", profile.first_name || "");
  await setAppSetting("profile_last_name", profile.last_name || "");
  await setAppSetting("profile_company_name", profile.company_name || "");
  await setAppSetting("profile_company_address", profile.company_address || "");
  await setAppSetting("profile_city", profile.city || "");
  await setAppSetting("profile_postal_code", profile.postal_code || "");
  await setAppSetting("profile_country", profile.country || "");
  await setAppSetting("profile_tax_number", profile.tax_number || "");
  await setAppSetting("profile_vat_id", profile.vat_id || "");
  return profile;
}

export async function listCategories(activeOnly = false): Promise<Category[]> {
  const rows = await queryRows<RowDataPacket[]>(
    `
    SELECT id, name, beschreibung, farbe, aktiv
    FROM kategorien
    ${activeOnly ? "WHERE aktiv = 1" : ""}
    ORDER BY name ASC
    `
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    beschreibung: row.beschreibung == null ? null : String(row.beschreibung),
    farbe: String(row.farbe ?? "#95A5A6"),
    aktiv: Number(row.aktiv ?? 1)
  }));
}

export async function createCategory(name: string, beschreibung: string, farbe: string): Promise<void> {
  await execute("INSERT INTO kategorien (name, beschreibung, farbe) VALUES (?, ?, ?)", [name, beschreibung, farbe]);
}

export async function deactivateCategory(categoryId: number): Promise<void> {
  await execute("UPDATE kategorien SET aktiv = 0 WHERE id = ?", [categoryId]);
}

export async function deleteCategory(categoryId: number): Promise<{ ok: boolean; message: string }> {
  const rows = await queryRows<RowDataPacket[]>("SELECT name FROM kategorien WHERE id = ? LIMIT 1", [categoryId]);
  if (rows.length === 0) {
    return { ok: false, message: "Kategorie nicht gefunden." };
  }

  const categoryName = String(rows[0].name);
  const countRows = await queryRows<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS total
    FROM rechnungen
    WHERE kategorie_id = ?
       OR (kategorie_id IS NULL AND kategorie_name = ?)
       OR (kategorie_id = 0 AND kategorie_name = ?)
    `,
    [categoryId, categoryName, categoryName]
  );

  const count = Number(countRows[0]?.total ?? 0);
  if (count > 0) {
    return {
      ok: false,
      message: "Diese Kategorie enthält Rechnungen. Zum Löschen muss die Kategorie zuerst geleert werden."
    };
  }

  await execute("DELETE FROM kategorien WHERE id = ?", [categoryId]);
  return { ok: true, message: "Kategorie gelöscht." };
}

export async function listBudgets(): Promise<Record<number, number>> {
  const rows = await queryRows<RowDataPacket[]>(
    `
    SELECT kategorie_id, monatsbudget
    FROM kategorie_budgets
    `
  );

  const out: Record<number, number> = {};
  for (const row of rows) {
    out[Number(row.kategorie_id)] = Number(row.monatsbudget ?? 0);
  }
  return out;
}

export async function upsertBudget(categoryId: number, monthlyBudget: number): Promise<void> {
  await execute(
    `
    INSERT INTO kategorie_budgets (kategorie_id, monatsbudget)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE monatsbudget = VALUES(monatsbudget)
    `,
    [categoryId, monthlyBudget]
  );
}

function mapInvoice(row: RowDataPacket): Invoice {
  return {
    id: Number(row.id),
    dateiname: String(row.dateiname ?? ""),
    original_dateiname: row.original_dateiname == null ? null : String(row.original_dateiname),
    dateipfad: String(row.dateipfad ?? ""),
    dateityp: String(row.dateityp ?? ""),
    rechnung_typ: row.rechnung_typ === "ausgang" ? "ausgang" : "eingang",
    rechnungsdatum: row.rechnungsdatum ? String(row.rechnungsdatum).slice(0, 10) : null,
    beschreibung: row.beschreibung == null ? null : String(row.beschreibung),
    lieferant: row.lieferant == null ? null : String(row.lieferant),
    kategorie_id: row.kategorie_id == null ? null : Number(row.kategorie_id),
    kategorie_name: row.kategorie_name == null ? null : String(row.kategorie_name),
    netto_betrag: row.netto_betrag == null ? null : Number(row.netto_betrag),
    mwst_satz: row.mwst_satz == null ? null : String(row.mwst_satz),
    mwst_betrag: row.mwst_betrag == null ? null : Number(row.mwst_betrag),
    brutto_betrag: row.brutto_betrag == null ? null : Number(row.brutto_betrag),
    waehrung: row.waehrung == null ? null : String(row.waehrung),
    qualitaet_score: row.qualitaet_score == null ? null : Number(row.qualitaet_score),
    faelligkeitsdatum: row.faelligkeitsdatum ? String(row.faelligkeitsdatum).slice(0, 10) : null,
    hochladezeit: String(row.hochladezeit ?? ""),
    aktualisierungszeit: String(row.aktualisierungszeit ?? ""),
    farbe: row.farbe == null ? null : String(row.farbe)
  };
}

export async function listInvoices(filters?: {
  typ?: "eingang" | "ausgang";
  category?: string;
  search?: string;
  limit?: number;
}): Promise<Invoice[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.typ) {
    where.push("r.rechnung_typ = ?");
    params.push(filters.typ);
  }
  if (filters?.category) {
    where.push("r.kategorie_name = ?");
    params.push(filters.category);
  }
  if (filters?.search?.trim()) {
    where.push(`
      LOWER(CONCAT_WS(' ',
        COALESCE(r.dateiname, ''),
        COALESCE(r.original_dateiname, ''),
        COALESCE(r.beschreibung, ''),
        COALESCE(r.lieferant, ''),
        COALESCE(r.kategorie_name, ''),
        COALESCE(r.netto_betrag, ''),
        COALESCE(r.mwst_betrag, ''),
        COALESCE(r.brutto_betrag, ''),
        COALESCE(r.waehrung, ''),
        COALESCE(r.rechnungsdatum, ''),
        COALESCE(r.faelligkeitsdatum, ''),
        COALESCE(r.hochladezeit, ''),
        COALESCE(r.aktualisierungszeit, '')
      )) LIKE ?
    `);
    params.push(`%${filters.search.trim().toLowerCase()}%`);
  }

  let sql = `
    SELECT r.*, k.farbe
    FROM rechnungen r
    LEFT JOIN kategorien k ON r.kategorie_id = k.id
  `;
  if (where.length > 0) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }
  sql += " ORDER BY COALESCE(r.rechnungsdatum, DATE(r.hochladezeit)) DESC, r.hochladezeit DESC";

  if (filters?.limit && filters.limit > 0) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  const rows = await queryRows<RowDataPacket[]>(sql, params);
  return rows.map(mapInvoice);
}

export async function getInvoiceById(invoiceId: number): Promise<Invoice | null> {
  const rows = await queryRows<RowDataPacket[]>(
    `
    SELECT r.*, k.farbe
    FROM rechnungen r
    LEFT JOIN kategorien k ON r.kategorie_id = k.id
    WHERE r.id = ?
    LIMIT 1
    `,
    [invoiceId]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapInvoice(rows[0]);
}

export async function insertInvoice(data: {
  dateiname: string;
  dateityp: string;
  rechnungTyp: "eingang" | "ausgang";
  rechnungsdatum: string | null;
  beschreibung: string | null;
  lieferant: string | null;
  kategorieId: number | null;
  kategorieName: string | null;
  nettoBetrag: number | null;
  mwstSatz: string | null;
  mwstBetrag: number | null;
  bruttoBetrag: number | null;
  waehrung: string | null;
  qualitaetScore: number;
  faelligkeitsdatum: string | null;
}): Promise<number> {
  const result = await execute(
    `
    INSERT INTO rechnungen (
      dateiname, dateipfad, dateityp, rechnung_typ, rechnungsdatum,
      beschreibung, lieferant, kategorie_id, kategorie_name,
      netto_betrag, mwst_satz, mwst_betrag, brutto_betrag, waehrung,
      qualitaet_score, faelligkeitsdatum
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      data.dateiname,
      `uploads/${data.dateiname}`,
      data.dateityp,
      data.rechnungTyp,
      data.rechnungsdatum,
      data.beschreibung,
      data.lieferant,
      data.kategorieId,
      data.kategorieName,
      data.nettoBetrag,
      data.mwstSatz,
      data.mwstBetrag,
      data.bruttoBetrag,
      data.waehrung ?? "EUR",
      data.qualitaetScore,
      data.faelligkeitsdatum
    ]
  );

  return Number(result.insertId);
}

export async function updateInvoice(invoiceId: number, payload: {
  lieferant: string | null;
  kategorieId: number | null;
  kategorieName: string;
  rechnungTyp: "eingang" | "ausgang";
  faelligkeitsdatum: string | null;
  rechnungsdatum: string | null;
  nettoBetrag: number | null;
  mwstSatz: string | null;
  mwstBetrag: number | null;
  bruttoBetrag: number | null;
  waehrung: string;
  beschreibung: string | null;
}): Promise<void> {
  await execute(
    `
    UPDATE rechnungen
    SET
      lieferant = ?,
      kategorie_id = ?,
      kategorie_name = ?,
      rechnung_typ = ?,
      faelligkeitsdatum = ?,
      rechnungsdatum = ?,
      netto_betrag = ?,
      mwst_satz = ?,
      mwst_betrag = ?,
      brutto_betrag = ?,
      waehrung = ?,
      beschreibung = ?
    WHERE id = ?
    `,
    [
      payload.lieferant,
      payload.kategorieId,
      payload.kategorieName,
      payload.rechnungTyp,
      payload.faelligkeitsdatum,
      payload.rechnungsdatum,
      payload.nettoBetrag,
      payload.mwstSatz,
      payload.mwstBetrag,
      payload.bruttoBetrag,
      payload.waehrung,
      payload.beschreibung,
      invoiceId
    ]
  );
}

export async function deleteInvoice(invoiceId: number): Promise<{ names: string[] }> {
  const rows = await queryRows<RowDataPacket[]>(
    "SELECT dateiname, dateipfad FROM rechnungen WHERE id = ? LIMIT 1",
    [invoiceId]
  );
  if (rows.length === 0) {
    return { names: [] };
  }

  const row = rows[0];
  const names = new Set<string>();
  const dbName = String(row.dateiname ?? "").trim();
  const pathName = String(row.dateipfad ?? "").split("/").pop() ?? "";

  if (dbName) names.add(dbName);
  if (pathName) names.add(pathName);

  await execute("DELETE FROM rechnungen WHERE id = ?", [invoiceId]);

  return { names: Array.from(names) };
}

export async function getCategoryNameById(categoryId: number | null): Promise<string> {
  if (!categoryId || categoryId <= 0) {
    return "Nicht kategorisiert";
  }
  const rows = await queryRows<RowDataPacket[]>("SELECT name FROM kategorien WHERE id = ? LIMIT 1", [categoryId]);
  if (rows.length === 0) {
    return "Nicht kategorisiert";
  }
  return String(rows[0].name);
}

export async function getDashboardStats(): Promise<{
  totals: {
    gesamt_anzahl: number;
    gesamt_summe: number;
    avg_betrag: number;
    eingang_summe: number;
    ausgang_summe: number;
    netto_cashflow: number;
  };
  top: {
    zeitraum: string | null;
    kategorie: string | null;
    lieferant: string | null;
  };
  alerts: {
    offene_ueberfaellig: number;
    naechste_7_tage: number;
    niedrige_ocr: number;
  };
  trend30: number;
  budgetAlerts: Array<{
    id: number;
    name: string;
    farbe: string;
    monatsbudget: number;
    ausgegeben: number;
  }>;
}> {
  const totalsRow = await queryRows<RowDataPacket[]>(
    `
    SELECT
      COUNT(*) AS gesamt_anzahl,
      COALESCE(SUM(brutto_betrag), 0) AS gesamt_summe,
      COALESCE(AVG(brutto_betrag), 0) AS avg_betrag,
      COALESCE(SUM(CASE WHEN rechnung_typ = 'eingang' THEN brutto_betrag ELSE 0 END), 0) AS eingang_summe,
      COALESCE(SUM(CASE WHEN rechnung_typ = 'ausgang' THEN brutto_betrag ELSE 0 END), 0) AS ausgang_summe
    FROM rechnungen
    `
  );

  const topZeitraumRow = await queryRows<RowDataPacket[]>(
    `
    SELECT DATE_FORMAT(hochladezeit, '%Y-%m') AS zeitraum,
           SUM(COALESCE(brutto_betrag, 0)) AS total
    FROM rechnungen
    GROUP BY DATE_FORMAT(hochladezeit, '%Y-%m')
    ORDER BY total DESC
    LIMIT 1
    `
  );

  const topKategorieRow = await queryRows<RowDataPacket[]>(
    `
    SELECT COALESCE(kategorie_name, 'Nicht kategorisiert') AS kategorie,
           SUM(COALESCE(brutto_betrag, 0)) AS total
    FROM rechnungen
    GROUP BY COALESCE(kategorie_name, 'Nicht kategorisiert')
    ORDER BY total DESC
    LIMIT 1
    `
  );

  const topLieferantRow = await queryRows<RowDataPacket[]>(
    `
    SELECT COALESCE(NULLIF(TRIM(lieferant), ''), 'Unbekannt') AS lieferant,
           COUNT(*) AS anzahl
    FROM rechnungen
    GROUP BY COALESCE(NULLIF(TRIM(lieferant), ''), 'Unbekannt')
    ORDER BY anzahl DESC
    LIMIT 1
    `
  );

  const trendRow = await queryRows<RowDataPacket[]>(
    `
    SELECT
      SUM(CASE WHEN hochladezeit >= (NOW() - INTERVAL 30 DAY) THEN COALESCE(brutto_betrag,0) ELSE 0 END) AS aktuelle_30,
      SUM(CASE WHEN hochladezeit >= (NOW() - INTERVAL 60 DAY)
            AND hochladezeit < (NOW() - INTERVAL 30 DAY) THEN COALESCE(brutto_betrag,0) ELSE 0 END) AS vorherige_30
    FROM rechnungen
    `
  );

  const alertsRows = await queryRows<RowDataPacket[]>(
    `
    SELECT
      SUM(CASE WHEN rechnung_typ = 'eingang' AND faelligkeitsdatum IS NOT NULL AND faelligkeitsdatum < CURDATE() THEN 1 ELSE 0 END) AS offene_ueberfaellig,
      SUM(CASE WHEN rechnung_typ = 'eingang' AND faelligkeitsdatum IS NOT NULL AND faelligkeitsdatum BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS naechste_7_tage,
      SUM(CASE WHEN COALESCE(qualitaet_score, 0) < 50 THEN 1 ELSE 0 END) AS niedrige_ocr
    FROM rechnungen
    `
  );

  const budgetRows = await queryRows<RowDataPacket[]>(
    `
    SELECT
      k.id,
      k.name,
      k.farbe,
      kb.monatsbudget,
      COALESCE(SUM(r.brutto_betrag), 0) AS ausgegeben
    FROM kategorie_budgets kb
    JOIN kategorien k ON k.id = kb.kategorie_id
    LEFT JOIN rechnungen r ON r.kategorie_id = k.id
      AND DATE_FORMAT(r.hochladezeit, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
      AND r.rechnung_typ = 'eingang'
    GROUP BY k.id, k.name, k.farbe, kb.monatsbudget
    ORDER BY (COALESCE(SUM(r.brutto_betrag), 0) / NULLIF(kb.monatsbudget, 0)) DESC
    `
  );

  const t = totalsRow[0] ?? ({} as RowDataPacket);
  const current30 = Number((trendRow[0] as RowDataPacket)?.aktuelle_30 ?? 0);
  const previous30 = Number((trendRow[0] as RowDataPacket)?.vorherige_30 ?? 0);
  const trend30 = previous30 > 0 ? ((current30 - previous30) / previous30) * 100 : 0;

  return {
    totals: {
      gesamt_anzahl: Number(t.gesamt_anzahl ?? 0),
      gesamt_summe: Number(t.gesamt_summe ?? 0),
      avg_betrag: Number(t.avg_betrag ?? 0),
      eingang_summe: Number(t.eingang_summe ?? 0),
      ausgang_summe: Number(t.ausgang_summe ?? 0),
      netto_cashflow: Number(t.ausgang_summe ?? 0) - Number(t.eingang_summe ?? 0)
    },
    top: {
      zeitraum: topZeitraumRow[0] ? String(topZeitraumRow[0].zeitraum) : null,
      kategorie: topKategorieRow[0] ? String(topKategorieRow[0].kategorie) : null,
      lieferant: topLieferantRow[0] ? String(topLieferantRow[0].lieferant) : null
    },
    alerts: {
      offene_ueberfaellig: Number((alertsRows[0] as RowDataPacket)?.offene_ueberfaellig ?? 0),
      naechste_7_tage: Number((alertsRows[0] as RowDataPacket)?.naechste_7_tage ?? 0),
      niedrige_ocr: Number((alertsRows[0] as RowDataPacket)?.niedrige_ocr ?? 0)
    },
    trend30,
    budgetAlerts: budgetRows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      farbe: String(row.farbe ?? "#95A5A6"),
      monatsbudget: Number(row.monatsbudget ?? 0),
      ausgegeben: Number(row.ausgegeben ?? 0)
    }))
  };
}
