import { describe, expect, test } from "bun:test";
import {
  requireLocalHttpRuntimeConnection,
  requireRuntimeConnection,
  requireRuntimeWorkingDirectory,
} from "./runtime-connections";

describe("runtime-connections", () => {
  test("requireRuntimeConnection returns the provided connection", () => {
    const connection = {
      type: "stdio",
      workingDirectory: "/repo",
    } as const;

    expect(requireRuntimeConnection(connection, "list models")).toEqual(connection);
  });

  test("requireRuntimeConnection rejects missing connections", () => {
    expect(() => requireRuntimeConnection(null, "list models")).toThrow(
      "Runtime connection is required to list models.",
    );
  });

  test("requireRuntimeWorkingDirectory trims and validates the directory", () => {
    expect(
      requireRuntimeWorkingDirectory(
        {
          type: "stdio",
          workingDirectory: " /repo ",
        },
        "list models",
      ),
    ).toBe("/repo");
  });

  test("requireLocalHttpRuntimeConnection returns trimmed local_http transport data", () => {
    expect(
      requireLocalHttpRuntimeConnection(
        {
          type: "local_http",
          endpoint: " http://127.0.0.1:4444 ",
          workingDirectory: "/repo",
        },
        "list models",
      ),
    ).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
      workingDirectory: "/repo",
    });
  });

  test("requireLocalHttpRuntimeConnection rejects unsupported transports", () => {
    expect(() =>
      requireLocalHttpRuntimeConnection(
        {
          type: "stdio",
          workingDirectory: "/repo",
        },
        "list models",
      ),
    ).toThrow(
      "Runtime connection type 'stdio' is unsupported for list models; local_http is required.",
    );
  });
});
