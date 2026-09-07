import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  cubeBaseUrl: (process.env.CUBE_BASE_URL ?? "").replace(/\/$/, ""),
  cubeAccessToken: process.env.CUBE_ACCESS_TOKEN ?? "",
  cubeAppName: process.env.CUBE_APP_NAME ?? "ewelink-mcp",
  mcpPort: num("MCP_PORT", 3001),
  mcpApiKey: process.env.MCP_API_KEY ?? "",
  historyDbPath: process.env.HISTORY_DB_PATH ?? "./mcp-history.db",
  historyAutoRecordMs: num("HISTORY_AUTO_RECORD_MS", 300_000),
};

export function setCubeAccessToken(token: string): void {
  process.env.CUBE_ACCESS_TOKEN = token;
  config.cubeAccessToken = token;
}

export function requireCubeConfig(): void {
  if (!config.cubeBaseUrl) {
    throw new Error("CUBE_BASE_URL is not set. Copy .env.example to .env first.");
  }
}
