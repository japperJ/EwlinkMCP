import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { buildServer } from "./mcp/buildServer.js";
import { sseManager } from "./sse/manager.js";
import { getDevices } from "./cube/client.js";
import { getDb, recordDeviceSnapshot } from "./db/history.js";
import { registerHttp } from "./http/api.js";

const app = express();
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "ewelink-cube-mcp", sse: sseManager.status() });
});

// Optional API-key gate for AI coders over HTTP.
app.use("/mcp", (req, res, next) => {
  if (!config.mcpApiKey) return next();
  if (req.headers.authorization === `Bearer ${config.mcpApiKey}`) return next();
  res.status(401).json({ error: "Unauthorized: set Authorization: Bearer <MCP_API_KEY>" });
});

const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, McpServer>();

async function handleMcp(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => {
        transports.set(id, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        transports.delete(sid);
        const s = servers.get(sid);
        if (s) void s.close().catch(() => undefined);
        servers.delete(sid);
      }
    };
    const server = buildServer();
    servers.set(transport.sessionId ?? randomUUID(), server);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (sessionId) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    return;
  }
  res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: initialize first" }, id: null });
}

app.post("/mcp", (req, res) => void handleMcp(req, res));
app.get("/mcp", (req, res) => void handleMcp(req, res));
app.delete("/mcp", (req, res) => void handleMcp(req, res));

registerHttp(app);

function startBackground(): void {
  getDb(); // ensure own DB exists
  sseManager.start();
  if (config.historyAutoRecordMs > 0) {
    const tick = async () => {
      try {
        if (config.cubeAccessToken) {
          const res = await getDevices();
          sseManager.seed(res.data.device_list);
          for (const d of res.data.device_list) recordDeviceSnapshot(d);
        }
      } catch {
        // ignore; Cube may be offline
      }
    };
    void tick();
    setInterval(() => void tick(), config.historyAutoRecordMs);
  }
}

app.listen(config.mcpPort, () => {
  console.log(`ewelink-cube-mcp listening on http://localhost:${config.mcpPort}/mcp`);
  startBackground();
});
