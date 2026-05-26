import { describe, expect, test } from "bun:test";
import { buildWebDevCommand, resolveForwardedSignalExitCode } from "./dev";

describe("web dev script", () => {
  test("launches the workspace CLI with forwarded arguments", () => {
    expect(buildWebDevCommand(["--workspace", "--port", "1440"])).toEqual([
      "bun",
      "src/cli.ts",
      "--workspace",
      "--port",
      "1440",
    ]);
  });

  test("maps forwarded terminal signals to shell exit codes", () => {
    expect(resolveForwardedSignalExitCode("SIGINT")).toBe(130);
    expect(resolveForwardedSignalExitCode("SIGTERM")).toBe(143);
  });
});
