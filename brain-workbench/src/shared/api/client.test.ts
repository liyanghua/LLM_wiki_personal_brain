import { createApiClient, ApiError } from "./client";

describe("api client live-only", () => {
  it("throws ApiError when endpoint is unavailable", async () => {
    const client = createApiClient({
      apiBaseUrl: "http://127.0.0.1:9",
    });

    await expect(client.get("/api/profile/method")).rejects.toThrow();
  });

  it("returns parsed JSON on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ method_profile_id: "live-profile" }),
    });

    const client = createApiClient({
      apiBaseUrl: "http://localhost:8000",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const payload = await client.get<{ method_profile_id: string }>("/api/profile/method");
    expect(payload.method_profile_id).toBe("live-profile");
  });

  it("throws ApiError with status on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    });

    const client = createApiClient({
      apiBaseUrl: "http://localhost:8000",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    await expect(client.get("/api/missing")).rejects.toThrow(ApiError);
  });
});
