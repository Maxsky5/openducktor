import { afterEach, describe, expect, test } from "bun:test";
import { loadFileStatus, loadSessionDiff } from "./diff-ops";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("diff-ops", () => {
  test("loadSessionDiff parses wrapped diff payloads", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 3,
              deletions: 1,
              diff: "@@ -1 +1 @@",
            },
          ],
        }),
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 3,
        deletions: 1,
        diff: "@@ -1 +1 @@",
      },
    ]);
  });

  test("loadSessionDiff rejects HTTP failures with status context", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => {
          throw new Error("should not read body");
        },
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff (503 Service Unavailable)",
    );
  });

  test("loadFileStatus rejects malformed payloads", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ items: [] }),
      }) as Response) as typeof fetch;

    await expect(loadFileStatus("http://127.0.0.1:12345")).rejects.toThrow(
      "OpenCode request failed: load file status: unexpected response payload shape",
    );
  });

  test("loadFileStatus rejects transport errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket closed");
    }) as typeof fetch;

    await expect(loadFileStatus("http://127.0.0.1:12345")).rejects.toThrow(
      "OpenCode request failed: load file status: socket closed",
    );
  });
});
