import type { Express } from "express";
import * as cube from "../cube/client.js";
import { sseManager } from "../sse/manager.js";
import * as history from "../db/history.js";
import { rangeMs } from "../mcp/buildServer.js";
import { dashboardHtml } from "./dashboardPage.js";

const VALID_RANGES = new Set(["1h", "6h", "24h", "7d", "30d", "90d", "1y", "all"]);

export function registerHttp(app: Express): void {
  app.get("/dashboard", (_req, res) => {
    res.type("html").send(dashboardHtml);
  });

  app.get("/api/gateway", async (_req, res) => {
    try {
      const [info, runtime] = await Promise.all([cube.getGatewayInfo(), cube.getGatewayRuntime()]);
      res.json({ info, runtime, sse: sseManager.status() });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  app.get("/api/devices", async (_req, res) => {
    try {
      const result = await cube.getDevices();
      sseManager.seed(result.data.device_list);
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: 500, data: {}, message: (e as Error).message });
    }
  });

  app.get("/api/events", (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.json({ status: sseManager.status(), events: sseManager.recentEvents(limit), live: sseManager.liveCache() });
  });

  app.get("/api/history/devices", (_req, res) => {
    res.json(history.getDevicesWithHistory());
  });

  app.get("/api/history", (req, res) => {
    const serial = String(req.query.serial || "");
    const capability = String(req.query.capability || "");
    const range = String(req.query.range || "24h");
    const limit = Math.max(1, Math.min(20000, Number(req.query.limit) || 2000));
    if (!serial || !capability) {
      res.status(400).json({ error: "serial and capability are required" });
      return;
    }
    const now = Date.now();
    let fromMs: number;
    let toMs = now;
    // Custom date range (ISO date/datetime or epoch ms) takes precedence over presets.
    const toRaw = String(req.query.to || "");
    const fromRaw = String(req.query.from || "");
    if (fromRaw || toRaw) {
      const parse = (v: string, fallback: number): number => {
        if (!v) return fallback;
        if (/^\d+$/.test(v)) return Number(v);
        const t = Date.parse(v);
        return Number.isNaN(t) ? fallback : t;
      };
      fromMs = parse(fromRaw, 0);
      toMs = parse(toRaw, now);
    } else {
      if (!VALID_RANGES.has(range)) {
        res.status(400).json({ error: "valid range (1h,6h,24h,7d,30d,90d,1y,all) or from/to is required" });
        return;
      }
      fromMs = range === "all" ? 0 : now - (rangeMs[range] ?? rangeMs["24h"]);
    }
    res.json({ readings: history.getReadings(serial, capability, fromMs, toMs, limit) });
  });

  app.post("/api/power", async (req, res) => {
    try {
      const { serialNumber, action } = req.body as { serialNumber?: string; action?: string };
      if (!serialNumber || !["on", "off", "toggle"].includes(action || "")) {
        res.status(400).json({ error: "serialNumber and action (on|off|toggle) are required" });
        return;
      }
      const list = await cube.getDevices();
      const dev = list.data.device_list.find((d) => d.serial_number === serialNumber);
      if (!dev) {
        res.status(404).json({ error: "device not found" });
        return;
      }
      const cap = dev.capabilities.some((c) => c.capability === "power") ? "power" : "toggle";
      const key = cap === "power" ? "powerState" : "toggleState";
      res.json(await cube.updateDevice(serialNumber, { state: { [cap]: { [key]: action } } }));
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });
}
