import { routes } from "./routes";

describe("workbench routes", () => {
  it("registers all required workspace pages", () => {
    expect(routes.map((route) => route.path)).toEqual([
      "/",
      "/workspace/ask",
      "/workspace/writeback",
      "/workspace/assets",
      "/workspace/profile",
      "/workspace/eval",
      "/workspace/wiki",
    ]);
  });
});
