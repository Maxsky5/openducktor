import { describe, expect, test } from "bun:test";
import { buildDefaultFactory, nowIso } from "./client-factory";

describe("client-factory", () => {
  test("nowIso returns a parseable ISO string", () => {
    const value = nowIso();
    expect(typeof value).toBe("string");
    expect(value.includes("T")).toBe(true);
    expect(Number.isNaN(Date.parse(value))).toBe(false);
  });

  test("buildDefaultFactory creates an OpenCode client", () => {
    const createClient = buildDefaultFactory();
    const client = createClient({
      runtimeEndpoint: "http://127.0.0.1:4321",
      workingDirectory: "/",
    });

    expect(typeof client.session.create).toBe("function");
    expect(typeof (client.global as { event?: unknown }).event).toBe("function");
  });
});
