import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config, setCubeAccessToken } from "../config.js";
import * as cube from "../cube/client.js";
import { sseManager } from "../sse/manager.js";
import * as history from "../db/history.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const err = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true as const });

export const rangeMs: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "90d": 7_776_000_000,
  "1y": 31_536_000_000,
};

export function buildServer(): McpServer {
  const server = new McpServer({ name: "ewelink-cube-mcp", version: "0.1.0" });

  // ── Pairing / auth ──
  server.registerTool("cube_token_status", { description: "Show whether CUBE_BASE_URL and CUBE_ACCESS_TOKEN are configured" }, async () =>
    json({ baseUrl: config.cubeBaseUrl || null, tokenConfigured: Boolean(config.cubeAccessToken), sse: sseManager.status() }),
  );

  server.registerTool(
    "cube_pair_once",
    { description: "Single pairing attempt: GET access_token once (user must press iHost link button first)" },
    async () => {
      try {
        return json(await cube.requestAccessTokenOnce());
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_pair_wait",
    {
      description: "Poll access_token until the iHost link button is pressed, then activate the token in this server process",
      inputSchema: z.object({
        timeoutMs: z.number().int().min(5000).max(120000).default(30000),
        persistHint: z.boolean().default(true).describe("If true, response reminds to write the token into .env"),
      }),
    },
    async ({ timeoutMs }) => {
      try {
        const token = await cube.pollAccessToken(timeoutMs);
        setCubeAccessToken(token);
        return json({ token, active: true, note: "Token is active in this process. Add CUBE_ACCESS_TOKEN=<token> to .env to persist across restarts." });
      } catch (e) {
        return err(e);
      }
    },
  );

  // ── Gateway ──
  server.registerTool("cube_gateway_info", { description: "Get gateway bridge info (ip, mac, firmware, name)" }, async () => {
    try {
      return json(await cube.getGatewayInfo());
    } catch (e) {
      return err(e);
    }
  });

  server.registerTool("cube_gateway_runtime", { description: "Get gateway runtime (cpu, ram, temp, uptime)" }, async () => {
    try {
      return json(await cube.getGatewayRuntime());
    } catch (e) {
      return err(e);
    }
  });

  server.registerTool(
    "cube_gateway_volume",
    { description: "Set gateway speaker volume (0-100)", inputSchema: z.object({ volume: z.number().int().min(0).max(100) }) },
    async ({ volume }) => {
      try {
        return json(await cube.setGatewayVolume(volume));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool("cube_gateway_mute", { description: "Mute gateway speaker" }, async () => {
    try {
      return json(await cube.muteGateway());
    } catch (e) {
      return err(e);
    }
  });

  server.registerTool("cube_gateway_unmute", { description: "Unmute gateway speaker" }, async () => {
    try {
      return json(await cube.unmuteGateway());
    } catch (e) {
      return err(e);
    }
  });

  // ── Devices ──
  server.registerTool(
    "cube_list_devices",
    {
      description: "List all Zigbee devices on the CUBE",
      inputSchema: z.object({
        category: z.string().optional().describe("Filter by display_category, e.g. switch, light, temperatureAndHumiditySensor"),
        onlineOnly: z.boolean().default(false),
      }),
    },
    async ({ category, onlineOnly }) => {
      try {
        const res = await cube.getDevices();
        let list = res.data.device_list;
        if (category) list = list.filter((d) => d.display_category === category);
        if (onlineOnly) list = list.filter((d) => d.online);
        sseManager.seed(res.data.device_list);
        return json({ ...res, data: { device_list: list, total: list.length } });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_get_device",
    { description: "Get one device by serial number", inputSchema: z.object({ serialNumber: z.string() }) },
    async ({ serialNumber }) => {
      try {
        const res = await cube.getDevices();
        const dev = res.data.device_list.find((d) => d.serial_number === serialNumber);
        if (!dev) return { content: [{ type: "text" as const, text: `Device ${serialNumber} not found` }], isError: true as const };
        return json(dev);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_set_device_state",
    {
      description: "Generic control: PUT /devices/{serial} with {state}. Example state: {power:{powerState:'on'}}, {brightness:{brightness:80}}",
      inputSchema: z.object({ serialNumber: z.string(), state: z.record(z.record(z.unknown())) }),
    },
    async ({ serialNumber, state }) => {
      try {
        return json(await cube.updateDevice(serialNumber, { state }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_power",
    {
      description: "Switch/plug power control (uses power or toggle capability)",
      inputSchema: z.object({ serialNumber: z.string(), action: z.enum(["on", "off", "toggle"]) }),
    },
    async ({ serialNumber, action }) => {
      try {
        const res = await cube.getDevices();
        const dev = res.data.device_list.find((d) => d.serial_number === serialNumber);
        if (!dev) throw new Error(`Device ${serialNumber} not found`);
        const cap = dev.capabilities.some((c) => c.capability === "power") ? "power" : "toggle";
        const key = cap === "power" ? "powerState" : "toggleState";
        return json(await cube.updateDevice(serialNumber, { state: { [cap]: { [key]: action } } }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_set_brightness",
    { description: "Light brightness 1-100", inputSchema: z.object({ serialNumber: z.string(), brightness: z.number().int().min(1).max(100) }) },
    async ({ serialNumber, brightness }) => {
      try {
        return json(await cube.updateDevice(serialNumber, { state: { brightness: { brightness } } }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_set_color_temp",
    { description: "Light color temperature 0-100", inputSchema: z.object({ serialNumber: z.string(), colorTemperature: z.number().int().min(0).max(100) }) },
    async ({ serialNumber, colorTemperature }) => {
      try {
        return json(await cube.updateDevice(serialNumber, { state: { "color-temperature": { colorTemperature } } }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_set_rgb",
    {
      description: "Light RGB color 0-255 per channel",
      inputSchema: z.object({ serialNumber: z.string(), red: z.number().int().min(0).max(255), green: z.number().int().min(0).max(255), blue: z.number().int().min(0).max(255) }),
    },
    async ({ serialNumber, red, green, blue }) => {
      try {
        return json(await cube.updateDevice(serialNumber, { state: { "color-rgb": { red, green, blue } } }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_rename_device",
    { description: "Rename a device", inputSchema: z.object({ serialNumber: z.string(), name: z.string().min(1) }) },
    async ({ serialNumber, name }) => {
      try {
        return json(await cube.updateDevice(serialNumber, { name }));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "cube_query_state",
    {
      description: "Query device capability state (e.g. power-consumption with {start_time,end_time,interval})",
      inputSchema: z.object({ serialNumber: z.string(), capability: z.string(), query_state: z.record(z.unknown()) }),
    },
    async ({ serialNumber, capability, query_state }) => {
      try {
        return json(await cube.queryDeviceState(serialNumber, capability, query_state as Record<string, unknown>));
      } catch (e) {
        return err(e);
      }
    },
  );

  // ── Live events (long-lived SSE managed server-side) ──
  server.registerTool("cube_events_status", { description: "Status of the persistent CUBE SSE connection" }, async () =>
    json({ ...sseManager.status(), tokenConfigured: Boolean(config.cubeAccessToken) }),
  );

  server.registerTool(
    "cube_events_recent",
    { description: "Recent CUBE SSE events from the server-side buffer", inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }) },
    async ({ limit }) => json(sseManager.recentEvents(limit)),
  );

  server.registerTool("cube_live_cache", { description: "Live device state cache built from SSE + list_devices seeding" }, async () =>
    json(sseManager.liveCache()),
  );

  // ── History (separate MCP DB) ──
  server.registerTool(
    "history_record_snapshot",
    { description: "Record one device snapshot into this server's own history DB", inputSchema: z.object({ serialNumber: z.string() }) },
    async ({ serialNumber }) => {
      try {
        const res = await cube.getDevices();
        const dev = res.data.device_list.find((d) => d.serial_number === serialNumber);
        if (!dev) throw new Error(`Device ${serialNumber} not found`);
        return json({ recorded: history.recordDeviceSnapshot(dev) });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool("history_record_all", { description: "Record snapshots for all online devices" }, async () => {
    try {
      const res = await cube.getDevices();
      let total = 0;
      for (const d of res.data.device_list) total += history.recordDeviceSnapshot(d);
      return json({ recorded: total, devices: res.data.device_list.length });
    } catch (e) {
      return err(e);
    }
  });

  server.registerTool(
    "history_query",
    {
      description: "Query sensor readings (temperature, humidity, battery, rssi, voltage, electric-power)",
      inputSchema: z.object({
        serialNumber: z.string(),
        capability: z.string(),
        range: z.enum(["1h", "6h", "24h", "7d", "30d", "90d", "1y", "all"]).default("24h"),
        limit: z.number().int().min(1).max(20000).default(2000),
      }),
    },
    async ({ serialNumber, capability, range, limit }) => {
      const now = Date.now();
      const fromMs = range === "all" ? 0 : now - (rangeMs[range] ?? rangeMs["24h"]);
      return json({ readings: history.getReadings(serialNumber, capability, fromMs, now, limit) });
    },
  );

  server.registerTool("history_devices", { description: "Devices that have history in this server's DB" }, async () =>
    json(history.getDevicesWithHistory()),
  );
  server.registerTool("history_latest", { description: "Latest reading per device/capability" }, async () => json(history.getLatestReadings()));
  server.registerTool("history_stats", { description: "Total reading count" }, async () => json({ total_readings: history.getReadingCount() }));

  // ── Resources ──
  server.registerResource("gateway-info", "ewelink://gateway/info", { title: "Gateway info", mimeType: "application/json" }, async (uri) => {
    try {
      const res = await cube.getGatewayInfo();
      return { contents: [{ uri: uri.href, text: JSON.stringify(res, null, 2), mimeType: "application/json" }] };
    } catch (e) {
      return { contents: [{ uri: uri.href, text: JSON.stringify({ error: (e as Error).message }), mimeType: "application/json" }] };
    }
  });

  server.registerResource("devices-list", "ewelink://devices/list", { title: "Device list", mimeType: "application/json" }, async (uri) => {
    try {
      const res = await cube.getDevices();
      return { contents: [{ uri: uri.href, text: JSON.stringify(res, null, 2), mimeType: "application/json" }] };
    } catch (e) {
      return { contents: [{ uri: uri.href, text: JSON.stringify({ error: (e as Error).message }), mimeType: "application/json" }] };
    }
  });

  server.registerResource("events-recent", "ewelink://events/recent", { title: "Recent live events", mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(sseManager.recentEvents(100), null, 2), mimeType: "application/json" }],
  }));

  return server;
}
