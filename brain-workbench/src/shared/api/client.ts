export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

export interface ApiClientOptions {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(response.status, text || `请求失败: ${response.status}`);
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  if (!fetchImpl) {
    throw new Error("fetch 不可用，无法创建 API 客户端");
  }

  return {
    async get<T>(path: string): Promise<T> {
      const response = await fetchImpl(`${options.apiBaseUrl}${path}`);
      return parseResponse<T>(response);
    },
    async post<T>(path: string, body?: unknown): Promise<T> {
      const response = await fetchImpl(`${options.apiBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      return parseResponse<T>(response);
    },
  };
}

export const apiClient = createApiClient({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
});
