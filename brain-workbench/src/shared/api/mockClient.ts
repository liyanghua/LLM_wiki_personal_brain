export function createMockClient() {
  return {
    async get<T>(fallback: () => Promise<T> | T): Promise<T> {
      return await fallback();
    },
    async post<T>(fallback: () => Promise<T> | T): Promise<T> {
      return await fallback();
    },
  };
}
