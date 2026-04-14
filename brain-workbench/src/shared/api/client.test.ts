import { createApiClient } from "./client";

describe("api client fallback", () => {
  it("falls back to mock data when live endpoint is unavailable", async () => {
    const client = createApiClient({
      apiBaseUrl: "http://127.0.0.1:9",
      dataMode: "live",
    });

    const payload = await client.get("/api/profile/method", () => ({
      method_profile_id: "mock-profile",
    }));

    expect(payload.method_profile_id).toBe("mock-profile");
  });
});
