// Independent type declarations for eWeLink CUBE Open API v2.
// Re-declared here so this server has zero dependency on the dashboard repo.

export interface CubeApiResponse<T = unknown> {
  error: number;
  data: T;
  message: string;
}

export interface DeviceCapability {
  capability: string;
  permission: string;
  name?: string;
  settings?: Record<string, unknown>;
}

export type DeviceState = Record<string, Record<string, unknown>>;

export interface CubeDevice {
  serial_number: string;
  third_serial_number?: string;
  name: string;
  manufacturer: string;
  model: string;
  firmware_version: string;
  display_category: string;
  capabilities: DeviceCapability[];
  protocol?: string;
  state: DeviceState;
  tags?: Record<string, unknown>;
  online: boolean;
}

export interface DeviceListResponse {
  device_list: CubeDevice[];
}

export interface GatewayInfo {
  ip: string;
  mac: string;
  domain?: string;
  fw_version: string;
  name: string;
}

export interface GatewayRuntime {
  ram_used: number;
  cpu_used: number;
  power_up_time: string;
  cpu_temp: number;
  cpu_temp_unit: string;
  sd_card_used?: number;
}

export interface AccessTokenResponse {
  token: string;
}

export interface CubeSseEvent {
  /** e.g. device#v2#updateDeviceState */
  type: string;
  data: unknown;
  receivedAt: number;
}
