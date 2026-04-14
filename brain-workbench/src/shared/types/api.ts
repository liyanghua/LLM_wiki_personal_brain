export type DataMode = "live" | "mock";

export interface ApiClientOptions {
  apiBaseUrl: string;
  dataMode: DataMode;
  fetchImpl?: typeof fetch;
}
