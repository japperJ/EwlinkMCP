// Long-lived CUBE SSE connection: one persistent stream per server process,
// with auto-reconnect, a recent-event ring buffer, and a live device cache.
import { sseUrl } from "../cube/client.js";
import { config } from "../config.js";
import type { CubeDevice, CubeSseEvent, DeviceState } from "../cube/types.js";

const MAX_EVENTS = 200;

export class SseManager {
  private events: CubeSseEvent[] = [];
  private live = new Map<string, { state: DeviceState; online: boolean; name: string }>();
  private running = false;
  private connected = false;
  private abort: AbortController | null = null;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
  }

  status() {
    return { running: this.running, connected: this.connected, cachedDevices: this.live.size, bufferedEvents: this.events.length };
  }

  recentEvents(limit = 50): CubeSseEvent[] {
    return this.events.slice(-Math.max(1, Math.min(limit, MAX_EVENTS)));
  }

  liveCache(): Record<string, { state: DeviceState; online: boolean; name: string }> {
    return Object.fromEntries(this.live);
  }

  seed(devices: CubeDevice[]): void {
    for (const d of devices) this.live.set(d.serial_number, { state: d.state, online: d.online, name: d.name });
  }

  private push(type: string, data: unknown): void {
    this.events.push({ type, data, receivedAt: Date.now() });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    applyToCache(this.live, type, data);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (!config.cubeAccessToken) {
        await this.wait(5000);
        continue;
      }
      try {
        await this.connectOnce();
      } catch {
        // fall through to reconnect delay
      }
      this.connected = false;
      await this.wait(5000);
    }
  }

  private async connectOnce(): Promise<void> {
    this.abort = new AbortController();
    const res = await fetch(sseUrl(), {
      headers: { Accept: "text/event-stream" },
      signal: this.abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
    this.connected = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let currentEvent = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !this.running) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload) {
              try {
                this.push(currentEvent || "message", JSON.parse(payload));
              } catch {
                this.push(currentEvent || "message", { raw: payload });
              }
            }
            currentEvent = "";
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timer = setTimeout(resolve, ms);
    });
  }
}

function applyToCache(
  live: Map<string, { state: DeviceState; online: boolean; name: string }>,
  type: string,
  data: unknown,
): void {
  const d = data as { endpoint?: { serial_number?: string }; payload?: Record<string, unknown> };
  const sn = d?.endpoint?.serial_number;
  if (type === "device#v2#updateDeviceState" && sn && d.payload) {
    const prev = live.get(sn) ?? { state: {}, online: true, name: sn };
    live.set(sn, { ...prev, state: { ...prev.state, ...(d.payload as DeviceState) } });
  } else if (type === "device#v2#updateDeviceOnline" && sn) {
    const prev = live.get(sn) ?? { state: {}, online: true, name: sn };
    const online = (d.payload as { online?: boolean } | undefined)?.online;
    if (typeof online === "boolean") live.set(sn, { ...prev, online });
  } else if (type === "device#v2#addDevice" && d.payload) {
    const dev = d.payload as unknown as CubeDevice;
    if (dev.serial_number) live.set(dev.serial_number, { state: dev.state, online: dev.online, name: dev.name });
  } else if (type === "device#v2#deleteDevice" && sn) {
    live.delete(sn);
  }
}

export const sseManager = new SseManager();
