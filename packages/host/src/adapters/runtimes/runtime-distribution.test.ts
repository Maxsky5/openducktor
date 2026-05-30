import { HostValidationError } from "../../effect/host-errors";
import {
  createArtifactRuntimeDistribution,
  createSourceRuntimeDistribution,
} from "./runtime-distribution";

describe("runtime distribution factories", () => {
  test("rejects empty source workspace roots with a typed validation error", () => {
    expect(() => createSourceRuntimeDistribution(" ")).toThrow(HostValidationError);
    expect(() => createSourceRuntimeDistribution(" ")).toThrow("workspaceRoot cannot be empty.");
  });

  test("trims artifact launcher paths at construction time", () => {
    expect(
      createArtifactRuntimeDistribution({
        bundledToolBinDirs: { opencode: " /app/resources/bin " },
        mcpLauncher: {
          kind: "bunScript",
          bunExecutablePath: " /usr/local/bin/bun ",
          scriptPath: " /app/resources/openducktor-mcp.js ",
        },
      }),
    ).toMatchObject({
      mode: "artifact",
      bundledToolBinDirs: { opencode: "/app/resources/bin" },
      mcpLauncher: {
        kind: "bunScript",
        bunExecutablePath: "/usr/local/bin/bun",
        scriptPath: "/app/resources/openducktor-mcp.js",
      },
    });
  });

  test("rejects unsupported artifact launcher kinds with a typed validation error", () => {
    expect(() =>
      createArtifactRuntimeDistribution({
        mcpLauncher: {
          kind: "shellScript",
          scriptPath: "/app/openducktor-mcp.sh",
        } as never,
      }),
    ).toThrow(HostValidationError);
    expect(() =>
      createArtifactRuntimeDistribution({
        mcpLauncher: {
          kind: "shellScript",
          scriptPath: "/app/openducktor-mcp.sh",
        } as never,
      }),
    ).toThrow("Unsupported MCP launcher kind: shellScript");
  });
});
