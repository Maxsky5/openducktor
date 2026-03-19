import { describe, expect, test } from "bun:test";
import { repoConfigSchema } from "./config-schemas";

describe("config-schemas", () => {
  test("defaults dev servers to an empty array", () => {
    const parsed = repoConfigSchema.parse({});
    expect(parsed.devServers).toEqual([]);
  });

  test("requires named dev server commands", () => {
    expect(() =>
      repoConfigSchema.parse({
        devServers: [
          {
            id: "frontend",
            name: "",
            command: "bun run dev",
          },
        ],
      }),
    ).toThrow();
  });
});
