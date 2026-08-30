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
          kind: "toolScript",
          scriptPath: " /app/resources/openducktor-mcp.js ",
          toolId: "bun",
        },
      }),
    ).toMatchObject({
      mode: "artifact",
      bundledToolBinDirs: { opencode: "/app/resources/bin" },
      mcpLauncher: {
        kind: "toolScript",
        scriptPath: "/app/resources/openducktor-mcp.js",
        toolId: "bun",
      },
    });
  });
});
