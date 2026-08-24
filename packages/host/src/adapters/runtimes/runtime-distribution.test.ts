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

  test("preserves bundled directory values when normalizing raw tool ids", () => {
    expect(
      createArtifactRuntimeDistribution({
        bundledToolBinDirs: {
          // @ts-expect-error -- This test verifies normalization before tool-id validation.
          " opencode ": " /app/resources/bin ",
        },
        mcpLauncher: {
          kind: "executable",
          executablePath: "/app/resources/openducktor-mcp",
        },
      }),
    ).toMatchObject({
      mode: "artifact",
      bundledToolBinDirs: { opencode: "/app/resources/bin" },
    });
  });

  test("rejects unsupported artifact launcher kinds with a typed validation error", () => {
    expect(() =>
      createArtifactRuntimeDistribution({
        mcpLauncher: {
          // @ts-expect-error -- This test verifies rejection of an unsupported launcher kind.
          kind: "shellScript",
          scriptPath: "/app/openducktor-mcp.sh",
        },
      }),
    ).toThrow(HostValidationError);
    expect(() =>
      createArtifactRuntimeDistribution({
        mcpLauncher: {
          // @ts-expect-error -- This test verifies rejection of an unsupported launcher kind.
          kind: "shellScript",
          scriptPath: "/app/openducktor-mcp.sh",
        },
      }),
    ).toThrow("Unsupported MCP launcher kind: shellScript");
  });

  test("rejects unsupported artifact tool script launcher ids with a typed validation error", () => {
    expect(() =>
      createArtifactRuntimeDistribution({
        mcpLauncher: {
          kind: "toolScript",
          scriptPath: "/app/openducktor-mcp.js",
          // @ts-expect-error -- This test verifies rejection of an unsupported bundled tool id.
          toolId: "node",
        },
      }),
    ).toThrow(HostValidationError);
    expect(() =>
      createArtifactRuntimeDistribution({
        mcpLauncher: {
          kind: "toolScript",
          scriptPath: "/app/openducktor-mcp.js",
          // @ts-expect-error -- This test verifies rejection of an unsupported bundled tool id.
          toolId: "node",
        },
      }),
    ).toThrow("mcpLauncher.toolId must be one of:");
  });

  test("rejects unsupported bundled tool directory ids with a typed validation error", () => {
    expect(() =>
      createArtifactRuntimeDistribution({
        bundledToolBinDirs: {
          // @ts-expect-error -- This test verifies rejection of an unsupported bundled tool id.
          node: "/app/resources/bin",
        },
        mcpLauncher: {
          kind: "executable",
          executablePath: "/app/resources/openducktor-mcp",
        },
      }),
    ).toThrow(HostValidationError);
    expect(() =>
      createArtifactRuntimeDistribution({
        bundledToolBinDirs: {
          // @ts-expect-error -- This test verifies rejection of an unsupported bundled tool id.
          node: "/app/resources/bin",
        },
        mcpLauncher: {
          kind: "executable",
          executablePath: "/app/resources/openducktor-mcp",
        },
      }),
    ).toThrow("bundledToolBinDirs.node must be one of:");
  });
});
