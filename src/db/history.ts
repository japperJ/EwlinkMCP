import Database from "better-sqlite3";
import { config } from "../config.js";

export interface Reading {
  id: number;
  serial_number: string;
  device_name: string;
  capability: string;
  value: number;
  unit: string;
  recorded_at: number;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(config.historyDbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT NOT NULL,
      device_name TEXT NOT NULL,
      capability TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      recorded_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_readings_device_time
      ON readings (serial_number, capability, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_readings_time ON readings (recorded_at);
  `);
  return db;
}

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Extract temperature/humidity/battery/rssi/voltage/power from a device snapshot. */
export function recordDeviceSnapshot(device: {
  serial_number: string;
  name: string;
  online: boolean;
  state: Record<string, Record<string, unknown>>;
}): number {
  if (!device.online) return 0;
  const rows: { capability: string; value: number; unit: string }[] = [];
  const s = device.state ?? {};
  const push = (cap: string, value: number | null, unit: string) => {
    if (value !== null) rows.push({ capability: cap, value, unit });
  };
  push("temperature", numeric(s.temperature?.temperature), "°C");
  push("humidity", numeric(s.humidity?.humidity), "%");
  push("battery", numeric(s.battery?.battery), "%");
  push("rssi", numeric(s.rssi?.rssi), "dBm");
  push("voltage", numeric(s.voltage?.voltage), "V");
  push("electric-power", numeric(s["electric-power"]?.["electric-power"]), "W");

  if (rows.length === 0) return 0;
  const d = getDb();
  const now = Date.now();
  const stmt = d.prepare(
    "INSERT INTO readings (serial_number, device_name, capability, value, unit, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const tx = d.transaction((input: typeof rows) => {
    for (const r of input) stmt.run(device.serial_number, device.name, r.capability, r.value, r.unit, now);
  });
  tx(rows);
  return rows.length;
}

export function getReadings(serialNumber: string, capability: string, fromMs: number, toMs: number, limit = 2000): Reading[] {
  return getDb()
    .prepare(
      `SELECT id, serial_number, device_name, capability, value, unit, recorded_at FROM readings
       WHERE serial_number = ? AND capability = ? AND recorded_at >= ? AND recorded_at <= ?
       ORDER BY recorded_at ASC LIMIT ?`,
    )
    .all(serialNumber, capability, fromMs, toMs, limit) as Reading[];
}

export function getDevicesWithHistory(): { serial_number: string; device_name: string; capabilities: string[] }[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT serial_number, device_name, capability FROM readings ORDER BY device_name, capability")
    .all() as { serial_number: string; device_name: string; capability: string }[];
  const map = new Map<string, { serial_number: string; device_name: string; capabilities: string[] }>();
  for (const r of rows) {
    let e = map.get(r.serial_number);
    if (!e) {
      e = { serial_number: r.serial_number, device_name: r.device_name, capabilities: [] };
      map.set(r.serial_number, e);
    }
    e.capabilities.push(r.capability);
  }
  return [...map.values()];
}

export function getLatestReadings(): Reading[] {
  return getDb()
    .prepare(
      `SELECT r.id, r.serial_number, r.device_name, r.capability, r.value, r.unit, r.recorded_at FROM readings r
       INNER JOIN (SELECT serial_number, capability, MAX(recorded_at) AS max_time FROM readings GROUP BY serial_number, capability) latest
       ON r.serial_number = latest.serial_number AND r.capability = latest.capability AND r.recorded_at = latest.max_time`,
    )
    .all() as Reading[];
}

export function getReadingCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS cnt FROM readings").get() as { cnt: number }).cnt;
}
