import { describe, expect, test } from "bun:test";
import { isAgentRuntimeCatalogSurfaceRequested } from "./agent-runtime-catalog";

describe("isAgentRuntimeCatalogSurfaceRequested", () => {
  test("requests every surface when no filter is set", () => {
    expect(isAgentRuntimeCatalogSurfaceRequested(undefined, "models")).toBe(true);
    expect(isAgentRuntimeCatalogSurfaceRequested(undefined, "slashCommands")).toBe(true);
    expect(isAgentRuntimeCatalogSurfaceRequested(undefined, "skills")).toBe(true);
    expect(isAgentRuntimeCatalogSurfaceRequested(undefined, "subagents")).toBe(true);
  });

  test("requests only the surfaces in the filter", () => {
    const surfaces = ["skills"] as const;

    expect(isAgentRuntimeCatalogSurfaceRequested(surfaces, "skills")).toBe(true);
    expect(isAgentRuntimeCatalogSurfaceRequested(surfaces, "models")).toBe(false);
    expect(isAgentRuntimeCatalogSurfaceRequested(surfaces, "slashCommands")).toBe(false);
    expect(isAgentRuntimeCatalogSurfaceRequested(surfaces, "subagents")).toBe(false);
  });
});
