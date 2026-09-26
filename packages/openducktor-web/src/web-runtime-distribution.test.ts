import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  resolveWebRuntimeDistribution,
  WEB_PACKAGE_MCP_ENTRYPOINT,
} from "./web-runtime-distribution";

describe("resolveWebRuntimeDistribution", () => {
  test("uses the Node MCP bundle for web dev mode", () => {
    expect(
      resolveWebRuntimeDistribution({
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
      mode: "artifact",
      mcpLauncher: { kind: "toolScript", toolId: "node" },
    });
  });

  test("requires an explicit workspace root in web dev mode", () => {
    const resolveDistribution = () =>
      resolveWebRuntimeDistribution({
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
      });
    expect(resolveDistribution).toThrow(
      "OpenDucktor web workspace mode requires a workspace root.",
    );
    expect(resolveDistribution).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("rejects a blank workspace root in web dev mode", () => {
    expect(() =>
      resolveWebRuntimeDistribution({
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
        workspaceRoot: " ",
      }),
    ).toThrow("workspaceRoot cannot be empty.");
  });

  test("uses the self-contained package MCP entrypoint in npm package mode", () => {
    const mcpEntrypoint = path.join(
      "/tmp/npx/@openducktor/web",
      "dist",
      WEB_PACKAGE_MCP_ENTRYPOINT,
    );

    const distribution = resolveWebRuntimeDistribution({
      packageRoot: "/tmp/npx/@openducktor/web",
      workspaceMode: false,
      workspaceRoot: "/repo/that/must/not/be/used",
    });

    expect(distribution).toMatchObject({
      mode: "artifact",
      mcpLauncher: {
        kind: "toolScript",
        scriptPath: mcpEntrypoint,
        toolId: "node",
      },
    });
    expect("bundledToolBinDirs" in distribution).toBe(false);
  });
});
