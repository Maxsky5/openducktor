import { afterEach, describe, expect, test } from "bun:test";
import { loadFileStatus, loadSessionDiff } from "./diff-ops";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("diff-ops", () => {
  test("loadSessionDiff parses wrapped diff payloads", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      requestedUrls.push(url.toString());
      return {
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
      } as Response;
    }) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 3,
        deletions: 1,
        diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n",
      },
    ]);
    expect(requestedUrls).toEqual(["http://127.0.0.1:12345/session/session-1/diff"]);
  });

  test("loadSessionDiff parses OpenCode snapshot diff payloads", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            file: "src/main.ts",
            patch: "@@ -1 +1 @@",
            additions: 2,
            deletions: 1,
            status: "modified",
          },
        ],
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n",
      },
    ]);
  });

  test("loadSessionDiff defaults missing OpenCode snapshot diff status to modified", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            file: "src/main.ts",
            patch: "@@ -1 +1 @@",
            additions: 2,
            deletions: 1,
          },
        ],
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n",
      },
    ]);
  });

  test("loadSessionDiff rejects standard payloads with full-file text instead of a diff", async () => {
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
              diff: 'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
            },
          ],
        }),
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff: unexpected OpenCode diff entry at index 0: diff for 'src/main.ts' is not a renderable file diff",
    );
  });

  test("loadSessionDiff rejects snapshot payloads with full-file text instead of a diff", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            file: "src/main.ts",
            patch: 'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
            additions: 2,
            deletions: 1,
            status: "modified",
          },
        ],
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff: unexpected OpenCode diff entry at index 0: diff for 'src/main.ts' is not a renderable file diff",
    );
  });

  test("loadSessionDiff rejects malformed OpenCode snapshot diff entries", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            file: "src/main.ts",
            patch: "@@ -1 +1 @@",
            additions: Number.NaN,
            deletions: 1,
            status: 5,
          },
        ],
      }) as Response) as typeof fetch;

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff: unexpected OpenCode diff entry at index 0: invalid additions, status fields",
    );
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
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      requestedUrls.push(url.toString());
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ items: [] }),
      } as Response;
    }) as typeof fetch;

    await expect(loadFileStatus("http://127.0.0.1:12345")).rejects.toThrow(
      "OpenCode request failed: load file status: unexpected response payload shape",
    );
    expect(requestedUrls).toEqual(["http://127.0.0.1:12345/file/status"]);
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
