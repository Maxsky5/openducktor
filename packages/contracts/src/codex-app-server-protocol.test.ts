import { describe, expect, test } from "bun:test";
import {
  CODEX_APP_SERVER_COMMAND_REQUEST_METHODS,
  CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS,
  CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS,
  CODEX_APP_SERVER_SERVER_REQUEST_METHOD,
  CODEX_APP_SERVER_SERVER_REQUEST_METHODS,
  type CodexAppServerClientRequest,
  isCodexAppServerCommandRequestMethod,
  isCodexAppServerFileMutationRequestMethod,
  isCodexAppServerJsonValue,
  isCodexAppServerMcpServerElicitationRequestParams,
  isCodexAppServerPermissionRequestMethod,
  isCodexAppServerRequestPermissionProfile,
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

  test("exposes the Codex server request methods from the upstream protocol", () => {
    expect(CODEX_APP_SERVER_SERVER_REQUEST_METHODS).toEqual([
      "account/chatgptAuthTokens/refresh",
      "applyPatchApproval",
      "attestation/generate",
      "execCommandApproval",
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "item/tool/call",
      "item/tool/requestUserInput",
      "mcpServer/elicitation/request",
    ]);
  });

  test("exposes command approval methods separately from mutation methods", () => {
    expect(CODEX_APP_SERVER_COMMAND_REQUEST_METHODS).toEqual([
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.EXEC_COMMAND_APPROVAL,
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
    ]);
    expect(isCodexAppServerCommandRequestMethod("execCommandApproval")).toBe(true);
    expect(isCodexAppServerCommandRequestMethod("item/commandExecution/requestApproval")).toBe(
      true,
    );
    expect(isCodexAppServerCommandRequestMethod("item/permissions/requestApproval")).toBe(false);
  });

  test("classifies file mutation and permission request approval methods", () => {
    expect(CODEX_APP_SERVER_FILE_MUTATION_REQUEST_METHODS).toEqual([
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.APPLY_PATCH_APPROVAL,
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_FILE_CHANGE_REQUEST_APPROVAL,
    ]);
    expect(CODEX_APP_SERVER_PERMISSION_REQUEST_METHODS).toEqual([
      CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
    ]);
    expect(isCodexAppServerFileMutationRequestMethod("applyPatchApproval")).toBe(true);
    expect(isCodexAppServerFileMutationRequestMethod("item/fileChange/requestApproval")).toBe(true);
    expect(isCodexAppServerFileMutationRequestMethod("item/permissions/requestApproval")).toBe(
      false,
    );
    expect(isCodexAppServerPermissionRequestMethod("item/permissions/requestApproval")).toBe(true);
    expect(isCodexAppServerPermissionRequestMethod("item/tool/requestUserInput")).toBe(false);
  });

  test("recognizes complete permission profiles without treating partial shapes as valid", () => {
    expect(
      isCodexAppServerRequestPermissionProfile({
        network: null,
        fileSystem: {
          read: ["/repo"],
          write: null,
          entries: [{ path: { type: "path", path: "/repo" }, access: "read" }],
        },
      }),
    ).toBe(true);
    expect(isCodexAppServerRequestPermissionProfile({ network: null })).toBe(false);
    expect(
      isCodexAppServerRequestPermissionProfile({
        network: null,
        fileSystem: {
          read: null,
          write: null,
          entries: [{ path: {}, access: "read" }],
        },
      }),
    ).toBe(false);
  });

  test("recognizes Codex MCP server elicitation request params", () => {
    expect(
      isCodexAppServerMcpServerElicitationRequestParams({
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "openducktor",
        mode: "form",
        _meta: { codex_approval_kind: "mcp_tool_call" },
        message: 'Allow openducktor to run tool "odt_read_task"?',
        requestedSchema: { type: "object", properties: {} },
      }),
    ).toBe(true);
    expect(
      isCodexAppServerMcpServerElicitationRequestParams({
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "openducktor",
        mode: "form",
        _meta: undefined,
        message: "Allow request?",
        requestedSchema: { type: "object", properties: {} },
      }),
    ).toBe(false);
  });
});
