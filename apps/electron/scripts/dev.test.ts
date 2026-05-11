import { describe, expect, test } from "bun:test";
import { resolveRendererDevUrl } from "./dev";

describe("electron dev script", () => {
  test("uses the declared renderer dev server URL", () => {
    expect(resolveRendererDevUrl("http://127.0.0.1:1430/")).toBe("http://127.0.0.1:1430");
  });

  test("fails when the renderer URL is missing", () => {
    expect(() => resolveRendererDevUrl(undefined)).toThrow(
      "VITE_DEV_SERVER_URL is required for Electron development.",
    );
  });

  test("fails when the renderer URL does not include a port", () => {
    expect(() => resolveRendererDevUrl("http://127.0.0.1")).toThrow(
      "VITE_DEV_SERVER_URL must include an explicit port: http://127.0.0.1",
    );
  });
});
