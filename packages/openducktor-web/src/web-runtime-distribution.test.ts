import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  resolveWebRuntimeDistribution,
  WEB_PACKAGE_MCP_ENTRYPOINT,
} from "./web-runtime-distribution";

describe("resolveWebRuntimeDistribution", () => {
  test("uses the workspace source distribution for web dev mode", () => {
    expect(
      resolveWebRuntimeDistribution({
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
        workspaceRoot: "/repo",
      }),
    ).toMatchObject({
      mode: "source",
      workspaceRoot: "/repo",
    });
  });

  test("requires an explicit workspace root in web dev mode", () => {
    expect(() =>
      resolveWebRuntimeDistribution({
        packageRoot: "/repo/packages/openducktor-web",
        workspaceMode: true,
      }),
    ).toThrow("OpenDucktor web workspace mode requires a workspace root.");
  });

  test("uses the self-contained package MCP entrypoint in npm package mode", () => {
    const mcpEntrypoint = path.join(
      "/tmp/bunx/@openducktor/web",
      "dist",
      WEB_PACKAGE_MCP_ENTRYPOINT,
    );

    expect(
      resolveWebRuntimeDistribution({
        bunExecutable: "/usr/local/bin/bun",
        packageRoot: "/tmp/bunx/@openducktor/web",
        workspaceMode: false,
        workspaceRoot: "/repo/that/must/not/be/used",
      }),
    ).toMatchObject({
      mode: "artifact",
      mcpLauncher: {
        kind: "bunScript",
        bunExecutablePath: "/usr/local/bin/bun",
        scriptPath: mcpEntrypoint,
      },
    });
  });

  test("uses the current Bun executable for the npm package MCP launcher by default", () => {
    const bunExecutable = Bun.argv[0];
    if (!bunExecutable) {
      throw new Error("Expected Bun.argv[0] to be available in Bun tests.");
    }

    expect(
      resolveWebRuntimeDistribution({
        packageRoot: "/tmp/bunx/@openducktor/web",
        workspaceMode: false,
      }),
    ).toMatchObject({
      mode: "artifact",
      mcpLauncher: {
        kind: "bunScript",
        bunExecutablePath: bunExecutable,
        scriptPath: path.join("/tmp/bunx/@openducktor/web", "dist", WEB_PACKAGE_MCP_ENTRYPOINT),
      },
    });
  });
});
