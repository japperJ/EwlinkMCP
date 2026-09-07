// Independent CUBE Open API v2 client (fetch-based, no shared code).
import { config, requireCubeConfig } from "../config.js";
import type {
  AccessTokenResponse,
  CubeApiResponse,
  CubeDevice,
  DeviceListResponse,
  GatewayInfo,
  GatewayRuntime,
} from "./types.js";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.cubeAccessToken) h.Authorization = `Bearer ${config.cubeAccessToken}`;
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<CubeApiResponse<T>> {
  requireCubeConfig();
  const res = await fetch(`${config.cubeBaseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    cache: "no-store" as RequestCache,
  });
  if (!res.ok) throw new Error(`CUBE API error: ${res.status} ${res.statusText}`);
  return (await res.json()) as CubeApiResponse<T>;
}

export function sseUrl(): string {
  requireCubeConfig();
  return `${config.cubeBaseUrl}/open-api/v2/sse/bridge?access_token=${encodeURIComponent(config.cubeAccessToken)}`;
}

// ── Pairing / token ──
export async function requestAccessTokenOnce(): Promise<CubeApiResponse<AccessTokenResponse>> {
  requireCubeConfig();
  const url = `${config.cubeBaseUrl}/open-api/v2/rest/bridge/access_token?app_name=${encodeURIComponent(config.cubeAppName)}`;
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  return (await res.json()) as CubeApiResponse<AccessTokenResponse>;
}

export async function pollAccessToken(timeoutMs = 30_000, intervalMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastMessage = "no token yet";
  while (Date.now() < deadline) {
    const json = await requestAccessTokenOnce();
    if (json.error === 0 && json.data?.token) return json.data.token;
    lastMessage = json.message || `error ${json.error}`;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Pairing timed out after ${timeoutMs}ms (${lastMessage}). Press the link button on the iHost and retry.`);
}

// ── Gateway ──
export const getGatewayInfo = () => request<GatewayInfo>("/open-api/v2/rest/bridge");
export const getGatewayRuntime = () => request<GatewayRuntime>("/open-api/v2/rest/bridge/runtime");
export const setGatewayVolume = (volume: number) =>
  request<object>("/open-api/v2/rest/bridge/config", { method: "PUT", body: JSON.stringify({ volume }) });
export const muteGateway = () => request<object>("/open-api/v2/rest/bridge/mute", { method: "PUT" });
export const unmuteGateway = () => request<object>("/open-api/v2/rest/bridge/unmute", { method: "PUT" });

// ── Devices ──
export const getDevices = () => request<DeviceListResponse>("/open-api/v2/rest/devices");

export function updateDevice(
  serialNumber: string,
  data: { name?: string; tags?: Record<string, unknown>; state?: Record<string, unknown> },
): Promise<CubeApiResponse<CubeDevice>> {
  return request<CubeDevice>(`/open-api/v2/rest/devices/${encodeURIComponent(serialNumber)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function queryDeviceState(
  serialNumber: string,
  capability: string,
  queryState: Record<string, unknown>,
): Promise<CubeApiResponse<object>> {
  return request<object>(
    `/open-api/v2/rest/devices/${encodeURIComponent(serialNumber)}/query-state/${encodeURIComponent(capability)}`,
    { method: "POST", body: JSON.stringify({ query_state: queryState }) },
  );
}
