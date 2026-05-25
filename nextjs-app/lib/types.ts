export type InvoiceType = "eingang" | "ausgang";

export interface SessionUser {
  id: number;
  username: string;
}

export interface Category {
  id: number;
  name: string;
  beschreibung: string | null;
  farbe: string;
  aktiv: number;
}

export interface Invoice {
  id: number;
  dateiname: string;
  original_dateiname: string | null;
  dateipfad: string;
  dateityp: string;
  rechnung_typ: InvoiceType;
  rechnungsdatum: string | null;
  beschreibung: string | null;
  lieferant: string | null;
  kategorie_id: number | null;
  kategorie_name: string | null;
  netto_betrag: number | null;
  mwst_satz: string | null;
  mwst_betrag: number | null;
  brutto_betrag: number | null;
  waehrung: string | null;
  qualitaet_score: number | null;
  faelligkeitsdatum: string | null;
  hochladezeit: string;
  aktualisierungszeit: string;
  farbe?: string | null;
}

export interface AiSettings {
  ai_service: string;
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
}

export interface UserProfile {
  username: string;
  first_name: string;
  last_name: string;
  company_name: string;
  company_address: string;
  city: string;
  postal_code: string;
  country: string;
  tax_number: string;
  vat_id: string;
}
