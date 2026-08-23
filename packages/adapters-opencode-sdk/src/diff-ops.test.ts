import { afterEach, describe, expect, test } from "bun:test";
import type { JsonValue } from "@openducktor/contracts";
import { loadFileStatus, loadSessionDiff } from "./diff-ops";

const originalFetch = globalThis.fetch;

const requestUrl = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : input.toString();

const installFetch = (handler: (input: string | URL | Request) => Response | Promise<Response>) => {
  const fetchImplementation: typeof fetch = async (input) => handler(input);
  globalThis.fetch = fetchImplementation;
};

const jsonResponse = (body: JsonValue): Response => {
  const encodedBody = JSON.stringify(body);
  if (encodedBody === undefined) {
    throw new Error("Test response body must be JSON serializable.");
  }
  return new Response(encodedBody, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("diff-ops", () => {
  test("loadSessionDiff parses the current OpenCode snapshot diff response", async () => {
    const requestedUrls: string[] = [];
    installFetch((input) => {
      requestedUrls.push(requestUrl(input));
      return jsonResponse([
        {
          file: "src/main.ts",
          patch: "@@ -1 +1 @@",
          additions: 2,
          deletions: 1,
          status: "modified",
        },
      ]);
    });

    await expect(
      loadSessionDiff("http://127.0.0.1:12345", "session-1", "message-1"),
    ).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n",
      },
    ]);
    expect(requestedUrls).toEqual([
      "http://127.0.0.1:12345/session/session-1/diff?messageID=message-1",
    ]);
  });

  test("loadSessionDiff rejects missing current producer fields", async () => {
    installFetch(() =>
      jsonResponse([
        {
          file: "src/main.ts",
          additions: 2,
          deletions: 1,
        },
      ]),
    );

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff: unexpected OpenCode diff entry at index 0: missing patch, status fields",
    );
  });

  test("loadSessionDiff keeps modified full-file payloads path-only", async () => {
    installFetch(() =>
      jsonResponse([
        {
          file: "src/main.ts",
          patch: 'import { render } from "@testing-library/react";\nfunction AuthConsumer() {}\n',
          additions: 2,
          deletions: 1,
          status: "modified",
        },
      ]),
    );

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "",
      },
    ]);
  });

  test("loadSessionDiff renders added full-file payloads as added-file diffs", async () => {
    installFetch(() =>
      jsonResponse([
        {
          file: "src/LandingPage.test.tsx",
          patch:
            "import LandingPage from '@/components/LandingPage';\ntest('renders', () => {});\n",
          additions: 2,
          deletions: 0,
          status: "added",
        },
      ]),
    );

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).resolves.toEqual([
      {
        file: "src/LandingPage.test.tsx",
        type: "added",
        additions: 2,
        deletions: 0,
        diff: "--- /dev/null\n+++ b/src/LandingPage.test.tsx\n@@ -0,0 +1,2 @@\n+import LandingPage from '@/components/LandingPage';\n+test('renders', () => {});\n",
      },
    ]);
  });

  test("loadSessionDiff rejects malformed snapshot diff entries", async () => {
    installFetch(() =>
      jsonResponse([
        {
          file: "src/main.ts",
          patch: "@@ -1 +1 @@",
          additions: [],
          deletions: 1,
          status: 5,
        },
      ]),
    );

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff",
    );
  });

  test("loadSessionDiff rejects HTTP failures with status context", async () => {
    installFetch(() => new Response(null, { status: 503, statusText: "Service Unavailable" }));

    await expect(loadSessionDiff("http://127.0.0.1:12345", "session-1")).rejects.toThrow(
      "OpenCode request failed: load session diff (503 Service Unavailable)",
    );
  });

  test("loadFileStatus maps the current OpenCode file status response", async () => {
    const requestedUrls: string[] = [];
    installFetch((input) => {
      requestedUrls.push(requestUrl(input));
      return jsonResponse([
        { path: "src/main.ts", added: 3, removed: 1, status: "modified" },
        { path: "src/new.ts", added: 4, removed: 0, status: "added" },
      ]);
    });

    await expect(loadFileStatus("http://127.0.0.1:12345")).resolves.toEqual([
      { path: "src/main.ts", status: "modified", staged: false },
      { path: "src/new.ts", status: "added", staged: false },
    ]);
    expect(requestedUrls).toEqual(["http://127.0.0.1:12345/file/status"]);
  });

  test("loadFileStatus rejects malformed payloads", async () => {
    installFetch(() => jsonResponse({ items: [] }));

    await expect(loadFileStatus("http://127.0.0.1:12345")).rejects.toThrow(
      "OpenCode request failed: load file status",
    );
  });

  test("loadFileStatus rejects transport errors", async () => {
    installFetch(() => {
      throw new Error("socket closed");
    });

    await expect(loadFileStatus("http://127.0.0.1:12345")).rejects.toThrow(
      "OpenCode request failed: load file status: socket closed",
    );
  });
});
