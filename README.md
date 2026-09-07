# eWeLink CUBE MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) server for the
**eWeLink CUBE (iHost) smart-home gateway**. It exposes every Cube function —
pairing, gateway info, device control, live events and sensor history — as MCP
tools over **Streamable HTTP**, so any AI assistant or coder agent can operate
your house. It also serves a small live **dashboard** web page.

Fully independent: the Cube client, types, SSE handling and history database are
re-implemented here. Zero dependency on the dashboard repo.

## Features

- **Pairing** — register against the Cube box via the physical link button
- **Gateway** — info, runtime stats, volume, mute/unmute
- **Devices** — list, inspect, rename, power, brightness, color temperature, RGB,
  generic state control, capability queries (e.g. power consumption)
- **Live** — one persistent SSE connection to the box with auto-reconnect,
  event buffer and live device cache
- **History** — own SQLite database, auto-records sensor snapshots every 5 min;
  queryable per device/metric over `1h…all`
- **Dashboard** — `GET /dashboard`: climate charts with date picker, live event feed

## Prerequisites

- **Node.js 20+** and npm
- An eWeLink CUBE / iHost gateway on the same LAN (this was built against
  firmware 2.13.2 at `http://192.168.50.22`)

## Setup

```bash
git clone <this-repo> && cd ewelink-cube-mcp
cp .env.example .env
npm install
```

Edit `.env`:

```env
CUBE_BASE_URL=http://192.168.50.22   # your Cube's address, no trailing slash
CUBE_ACCESS_TOKEN=                   # leave blank until paired (see below)
CUBE_APP_NAME=ewelink-mcp

MCP_PORT=3001
MCP_API_KEY=                         # optional: clients must send Authorization: Bearer <key>

HISTORY_DB_PATH=./mcp-history.db
HISTORY_AUTO_RECORD_MS=300000        # snapshot interval, 0 = disabled
```

Start it:

```bash
npm run dev    # development (tsx)
# or
npm run build && npm start
```

Endpoints:

| URL | What |
|---|---|
| `http://localhost:3001/mcp` | MCP Streamable HTTP endpoint (for AI clients) |
| `http://localhost:3001/dashboard` | Live dashboard web page |
| `http://localhost:3001/health` | Health + SSE status |

Docker:

```bash
docker build -t ewelink-cube-mcp .
docker run -p 3001:3001 --env-file .env ewelink-cube-mcp
```

## Connecting to the Cube box (pairing)

The Cube issues tokens only after a physical confirmation:

1. Call the `cube_pair_wait` tool (default 30 s window).
2. Within the window, press the **link button** on the iHost (a confirmation
   pop-up may also appear in the iHost web console at `http://ihost.local`).
3. The tool returns `{"token": "..."}` and activates it immediately.
4. Persist it: set `CUBE_ACCESS_TOKEN=<token>` in `.env` (survives restarts;
   the token stays valid until the gateway is factory-reset).

Single attempt instead of polling: `cube_pair_once`.
Check state any time: `cube_token_status`.

## Tool signature conventions

Every tool speaks plain JSON. Conventions used across all signatures:

- **Device identity** — `serialNumber` (the Cube `serial_number` UUID, e.g.
  `"05a98571-6f4b-4404-b6a2-3d24be50ed62"`). Use `cube_list_devices` to discover them.
- **State object** — `state` mirrors the Cube capability model:
  `{ "<capability>": { "<field>": value } }`. Examples:
  - power: `{ "power": { "powerState": "on" } }`
  - multi-gang: `{ "toggle": { "toggleState": "off" } }`
  - brightness: `{ "brightness": { "brightness": 80 } }` (1–100)
  - color temp: `{ "color-temperature": { "colorTemperature": 50 } }` (0–100)
  - color: `{ "color-rgb": { "red": 255, "green": 0, "blue": 255 } }`
- **Success** — `{ "error": 0, "data": {...}, "message": "success" }`
- **Failure** — `{ "error": <code>, "data": {}, "message": "<reason>" }`, e.g.
  `110005` = device offline, `110021` = capability not queryable on that device.
- **History ranges** — `1h | 6h | 24h | 7d | 30d | 90d | 1y | all`.
- **Metric names** — `temperature (°C)`, `humidity (%)`, `battery (%)`,
  `rssi (dBm)`, `voltage (V)`, `electric-power (W)`.

## MCP tools (26)

### Auth

| Tool | Signature | Description |
|---|---|---|
| `cube_token_status` | `()` | Whether base URL + token are configured, plus SSE status |
| `cube_pair_once` | `()` | One token request (press link button first) |
| `cube_pair_wait` | `({ timeoutMs?: 5000–120000 = 30000 })` | Poll until the button press registers; activates token |

### Gateway

| Tool | Signature | Description |
|---|---|---|
| `cube_gateway_info` | `()` | Bridge info: ip, mac, firmware, name |
| `cube_gateway_runtime` | `()` | cpu %, ram %, cpu temp, uptime, SD usage |
| `cube_gateway_volume` | `({ volume: 0–100 })` | Speaker volume |
| `cube_gateway_mute` / `cube_gateway_unmute` | `()` | Mute / unmute speaker |

### Devices & control

| Tool | Signature | Description |
|---|---|---|
| `cube_list_devices` | `({ category?: string, onlineOnly?: false })` | All Zigbee devices; filter by `display_category` |
| `cube_get_device` | `({ serialNumber })` | Full detail incl. capabilities + current state |
| `cube_set_device_state` | `({ serialNumber, state })` | Generic control, any capability payload |
| `cube_power` | `({ serialNumber, action: "on" \| "off" \| "toggle" })` | Power via `power` or `toggle` capability, auto-detected |
| `cube_set_brightness` | `({ serialNumber, brightness: 1–100 })` | Light brightness |
| `cube_set_color_temp` | `({ serialNumber, colorTemperature: 0–100 })` | 0 warm … 100 cool |
| `cube_set_rgb` | `({ serialNumber, red, green, blue: 0–255 })` | RGB color |
| `cube_rename_device` | `({ serialNumber, name })` | Rename |
| `cube_query_state` | `({ serialNumber, capability, query_state })` | Live capability query, e.g. `power-consumption` with `{ type: "summarize", timeRange: { start, end } }` |

### Live events

| Tool | Signature | Description |
|---|---|---|
| `cube_events_status` | `()` | Persistent SSE connection state |
| `cube_events_recent` | `({ limit: 1–200 = 50 })` | Recent box events (state, online, add, delete) |
| `cube_live_cache` | `()` | Device state cache built from SSE + list seeding |

### History (own SQLite DB)

| Tool | Signature | Description |
|---|---|---|
| `history_record_snapshot` | `({ serialNumber })` | Record one device now |
| `history_record_all` | `()` | Record all online devices now |
| `history_query` | `({ serialNumber, capability, range = "24h", limit = 2000 (max 20000) })` | Readings series |
| `history_devices` | `()` | Devices with history + their metrics |
| `history_latest` | `()` | Latest reading per device/metric |
| `history_stats` | `()` | Total reading count |

## MCP resources

- `ewelink://gateway/info` — gateway info JSON
- `ewelink://devices/list` — full device list JSON
- `ewelink://events/recent` — recent live events JSON

## REST + dashboard

Besides MCP, the server exposes plain REST (used by the dashboard):

- `GET /dashboard` — climate charts (device picker, metric, presets + custom
  from/to date picker), live event feed. No build step, no external assets.
- `GET /api/gateway`, `GET /api/devices`, `GET /api/events?limit=`,
  `GET /api/history/devices`
- `GET /api/history?serial=&capability=&range=&limit=` or `&from=&to=`
  (ISO datetime or epoch ms)
- `POST /api/power` `{ serialNumber, action }`

### Graph signatures

Each chart line is one device (colors in the legend); X = time in browser
timezone, Y = metric value. Points are 5-minute snapshots — gaps mean no
recording. Metrics: **Temperature °C** (air temp), **Humidity %** (relative),
**Battery %** (wireless devices), **Signal dBm** (nearer 0 = stronger; −50 good,
−80 weak), **Power W** (current draw), **Voltage V**. "no data" = no readings
for that device/metric/period. The same explanation is shown on the dashboard
itself under "Reading the graphs".

## Connecting an AI client (opencode example)

```jsonc // opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": { "ewelink": {
    "type": "remote",
    "url": "http://localhost:3001/mcp",
    "oauth": false
  } } }
}
```

Any Streamable-HTTP MCP client works. If `MCP_API_KEY` is set, send
`Authorization: Bearer <key>`; clients must also send
`Accept: application/json, text/event-stream`.

## Project structure

```
src/
  index.ts          # Express + MCP transport + background jobs
  config.ts         # env handling
  cube/client.ts    # Open API v2 client (fetch)
  cube/types.ts     # Cube type declarations
  sse/manager.ts    # long-lived SSE: reconnect, event buffer, live cache
  db/history.ts     # SQLite history layer
  mcp/buildServer.ts# all 26 tools + 3 resources
  http/api.ts       # REST endpoints
  http/dashboardPage.ts # dashboard HTML (self-contained)
```

## Troubleshooting

- `link button not pressed` (401) — press the iHost button, then retry within the window.
- `110005 Device Offline` — the end device is unreachable; commands to it fail until it rejoins.
- `110021` on `cube_query_state` — that capability isn't queryable on that device
  (temperature/humidity are report-only; only `power-consumption` has history, and
  only on devices that declare the capability).
- **History gaps** — the box exposes no sensor-history API (its UI graphs come
  from internal storage). History exists only for periods this server (or the
  dashboard app) was running and recording.
- `Session not found` (-32001) — the MCP client must complete `initialize`
  first and send `Mcp-Session-Id` + `Mcp-Protocol-Version` headers afterwards.
