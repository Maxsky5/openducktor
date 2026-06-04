import { describe, expect, test } from "bun:test";
import {
  type CodexAppServerClientRequest,
  isCodexAppServerJsonValue,
  parseCodexAppServerRequestResult,
} from "./codex-app-server-protocol";

describe("Codex app-server protocol", () => {
  test("accepts one-shot fuzzy file search requests and JSON-compatible results", () => {
    const request = {
      method: "fuzzyFileSearch",
      params: {
        query: "src",
        roots: ["/repo"],
        cancellationToken: null,
      },
    } satisfies CodexAppServerClientRequest;

    const response = {
      files: [
        {
          root: "/repo",
          path: "src/main.ts",
          match_type: "file",
          file_name: "main.ts",
          score: 9.75,
          indices: [0, 1, 2],
        },
      ],
    };

    expect(isCodexAppServerJsonValue(request.params)).toBe(true);
    expect(parseCodexAppServerRequestResult(request.method, response)).toEqual(response);
  });

  test("rejects non-JSON-compatible fuzzy file search results", () => {
    expect(() =>
      parseCodexAppServerRequestResult("fuzzyFileSearch", {
        files: [
          {
            root: "/repo",
            path: "src/main.ts",
            match_type: "file",
            file_name: "main.ts",
            score: Number.NaN,
            indices: null,
          },
        ],
      }),
    ).toThrow("Codex app-server result must be JSON-compatible.");
  });
});
