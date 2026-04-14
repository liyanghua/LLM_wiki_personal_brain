import type { ApiClientOptions } from "@/shared/types/api";

export interface ApiClient {
  get<T>(path: string, fallback: () => Promise<T> | T): Promise<T>;
  post<T>(path: string, body: unknown, fallback: () => Promise<T> | T): Promise<T>;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  async function withFallback<T>(request: () => Promise<T>, fallback: () => Promise<T> | T): Promise<T> {
    if (options.dataMode === "mock" || !fetchImpl) {
      return await fallback();
    }
    try {
      return await request();
    } catch {
      // TODO(BACKEND_ENDPOINT_BINDING): remove broad fallback once all workbench endpoints are stable.
      return await fallback();
    }
  }

  return {
    async get<T>(path: string, fallback: () => Promise<T> | T): Promise<T> {
      return await withFallback(
        async () => {
          const response = await fetchImpl(`${options.apiBaseUrl}${path}`);
          return parseResponse<T>(response);
        },
        fallback,
      );
    },
    async post<T>(path: string, body: unknown, fallback: () => Promise<T> | T): Promise<T> {
      return await withFallback(
        async () => {
          const response = await fetchImpl(`${options.apiBaseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {}),
          });
          return parseResponse<T>(response);
        },
        fallback,
      );
    },
  };
}

export const apiClient = createApiClient({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
  dataMode: (import.meta.env.VITE_DATA_MODE as "live" | "mock" | undefined) ?? "live",
});
