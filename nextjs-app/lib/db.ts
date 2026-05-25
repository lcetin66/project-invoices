import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { ExecuteValues } from "mysql2";

const dbConfig = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASS ?? "",
  database: process.env.DB_NAME ?? "firma_rechnungen",
  charset: "utf8mb4",
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
};

const globalForDb = globalThis as unknown as {
  mysqlPool?: mysql.Pool;
  schemaReady?: Promise<void>;
};

export const pool = globalForDb.mysqlPool ?? mysql.createPool(dbConfig);

if (process.env.NODE_ENV !== "production") {
  globalForDb.mysqlPool = pool;
}

async function ensureSchemaInternal(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      \`value\` TEXT,
      aktualisierungszeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [columns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM rechnungen LIKE 'rechnungsdatum'");
  if (columns.length === 0) {
    await pool.query("ALTER TABLE rechnungen ADD COLUMN rechnungsdatum DATE NULL AFTER rechnung_typ");
  }

  const [originalNameColumns] = await pool.query<RowDataPacket[]>("SHOW COLUMNS FROM rechnungen LIKE 'original_dateiname'");
  if (originalNameColumns.length === 0) {
    await pool.query("ALTER TABLE rechnungen ADD COLUMN original_dateiname VARCHAR(255) NULL AFTER dateiname");
  }
}

export async function ensureSchema(): Promise<void> {
  if (!globalForDb.schemaReady) {
    globalForDb.schemaReady = ensureSchemaInternal().catch((err) => {
      globalForDb.schemaReady = undefined;
      throw err;
    });
  }
  await globalForDb.schemaReady;
}

export async function queryRows<T = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  await ensureSchema();
  const [rows] = await pool.query(sql, params);
  return rows as T;
}

export async function execute(sql: string, params: ExecuteValues[] = []): Promise<ResultSetHeader> {
  await ensureSchema();
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function getAppSetting(key: string, fallback = ""): Promise<string> {
  const rows = await queryRows<RowDataPacket[]>("SELECT `value` FROM app_settings WHERE `key` = ?", [key]);
  if (rows.length === 0) {
    return fallback;
  }
  return String(rows[0].value ?? fallback);
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await execute(
    `
    INSERT INTO app_settings (\`key\`, \`value\`) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
    `,
    [key, value]
  );
}
