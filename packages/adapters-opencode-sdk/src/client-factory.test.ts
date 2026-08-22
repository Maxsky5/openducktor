import { runtimeTypeName } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { buildDefaultFactory, nowIso } from "./client-factory";

describe("client-factory", () => {
  test("nowIso returns a parseable ISO string", () => {
    const value = nowIso();
    expect(runtimeTypeName(value)).toBe("string");
    expect(value.includes("T")).toBe(true);
    expect(Number.isNaN(Date.parse(value))).toBe(false);
  });

  test("buildDefaultFactory creates an OpenCode client", () => {
    const createClient = buildDefaultFactory();
    const client = createClient({
      runtimeEndpoint: "http://127.0.0.1:4321",
      workingDirectory: "/",
    });

    expect(runtimeTypeName(client.session.create)).toBe("function");
    // SAFETY: This test controls the fixture and supplies `{ event?: unknown }` used by this case.
    expect(runtimeTypeName((client.global as { event?: unknown }).event)).toBe("function");
  });
});
