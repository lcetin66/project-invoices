-- RechnungsManager - Datenbank-Schema
-- Importieren Sie diese Datei in phpMyAdmin.

CREATE DATABASE IF NOT EXISTS firma_rechnungen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE firma_rechnungen;

-- Benutzer-Tabelle
CREATE TABLE IF NOT EXISTS benutzer (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    benutzername VARCHAR(100) NOT NULL UNIQUE,
    passwort_hash VARCHAR(255) NOT NULL,
    erstellungszeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kategorien-Tabelle
CREATE TABLE IF NOT EXISTS kategorien (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    beschreibung TEXT,
    farbe VARCHAR(7) DEFAULT '#4A90D9',
    aktiv TINYINT(1) DEFAULT 1,
    erstellungszeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Rechnungen-Tabelle
CREATE TABLE IF NOT EXISTS rechnungen (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    dateiname VARCHAR(255) NOT NULL,
    dateipfad VARCHAR(512) NOT NULL,
    dateityp VARCHAR(20) NOT NULL,
    rechnung_typ ENUM('eingang', 'ausgang') NOT NULL DEFAULT 'eingang',
    beschreibung TEXT,
    lieferant VARCHAR(255),
    kategorie_id INT UNSIGNED,
    kategorie_name VARCHAR(100),
    netto_betrag DECIMAL(15,2),
    mwst_satz VARCHAR(10),
    mwst_betrag DECIMAL(15,2),
    brutto_betrag DECIMAL(15,2),
    waehrung VARCHAR(10) DEFAULT 'EUR',
    klassifiziert TINYINT(1) DEFAULT 1,
    qualitaet_score TINYINT UNSIGNED DEFAULT 0,
    faelligkeitsdatum DATE NULL,
    hochladezeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    aktualisierungszeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (kategorie_id) REFERENCES kategorien(id) ON DELETE SET NULL,
    INDEX idx_kategorie (kategorie_id),
    INDEX idx_datum (hochladezeit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Monatsbudgets pro Kategorie
CREATE TABLE IF NOT EXISTS kategorie_budgets (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    kategorie_id INT UNSIGNED NOT NULL UNIQUE,
    monatsbudget DECIMAL(15,2) NOT NULL DEFAULT 0,
    aktualisierungszeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (kategorie_id) REFERENCES kategorien(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Standards-Kategorien
INSERT INTO kategorien (name, beschreibung, farbe) VALUES
('Büromaterial', 'Papier, Stifte, Mappen und andere Bürobedarfsartikel', '#E67E22'),
('Software & Hardware', 'Computer, Software-Lizenzen, Technik', '#9B59B6'),
('Transport', 'Taxi, Bus, Zug, Flugtickets', '#2ECC71'),
('Gastronomie', 'Restaurant, Café, Verpflegung', '#E74C3C'),
('Büromiete', 'Miete, Nebenkosten, Rechnungen', '#3498DB'),
('Telekommunikation', 'Telefon, Mobilfunk, Internet, Telekommunikationsdienste', '#0EA5A6'),
('Beratung', 'Rechtsanwalt, Steuerberater, Berater', '#1ABC9C'),
('Marketing', 'Werbung, Promotion, Messekosten', '#F39C12'),
('Sonstige', 'Alle anderen Ausgaben', '#95A5A6');

-- Standard-Benutzer (Passwort: admin123)
-- Bitte ändern Sie das Passwort über phpMyAdmin!
INSERT INTO benutzer (benutzername, passwort_hash) VALUES
('admin', '$2y$10$EkzNl/EfWRKpjt0108UbYOSowJOkKGgeMU8esvbzogszEbBDR.U9e');
