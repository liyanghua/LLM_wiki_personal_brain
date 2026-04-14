export const mockModeLabel =
  (import.meta.env.VITE_DATA_MODE as "live" | "mock" | undefined) === "mock" ? "Mock Mode" : "Live With Mock Fallback";
