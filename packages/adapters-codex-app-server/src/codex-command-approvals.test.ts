import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import { classifyCodexCommandRequestMutation } from "./codex-command-approvals";

const CURL_NETWORK_COMMAND =
  "curl -I --max-time 5 https://example.com; curl -I --max-time 5 https://1.1.1.1";

describe("classifyCodexCommandRequestMutation", () => {
  test("keeps read-only command actions read-only", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          commandActions: [
            {
              type: "read",
              command: "Get-Content AGENTS.md",
              name: "AGENTS.md",
              path: "AGENTS.md",
            },
            { type: "search", command: "rg auth", path: null, query: "auth" },
          ],
        },
      }),
    ).toBe("read_only");
  });

  test("keeps unknown network command actions actionable", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          command: CURL_NETWORK_COMMAND,
          commandActions: [
            {
              type: "unknown",
              command: CURL_NETWORK_COMMAND,
            },
          ],
          proposedExecpolicyAmendment: ["curl", "-I", "--max-time", "5", "https://example.com"],
        },
      }),
    ).toBe("unknown");
  });

  test("keeps managed network approvals actionable", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          command: "curl -I --max-time 5 https://example.com",
          commandActions: [
            { type: "unknown", command: "curl -I --max-time 5 https://example.com" },
          ],
          networkApprovalContext: {
            host: "example.com",
            protocol: "https",
          },
        },
      }),
    ).toBe("unknown");
  });

  test("keeps read-only command actions with managed network approvals actionable", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          command: "cat README.md",
          commandActions: [{ type: "read", command: "cat README.md", path: "README.md" }],
          networkApprovalContext: {
            host: "example.com",
            protocol: "https",
          },
        },
      }),
    ).toBe("unknown");
  });

  test("keeps network-only additional permissions actionable", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          command: "curl -I --max-time 5 https://example.com",
          commandActions: [
            { type: "unknown", command: "curl -I --max-time 5 https://example.com" },
          ],
          additionalPermissions: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
      }),
    ).toBe("unknown");
  });

  test("keeps read-only command actions with network-only additional permissions actionable", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          command: "cat README.md",
          commandActions: [{ type: "read", command: "cat README.md", path: "README.md" }],
          additionalPermissions: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
      }),
    ).toBe("unknown");
  });

  test("treats explicit write permission requests as mutating", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          commandActions: [
            {
              type: "read",
              command: "Get-Content AGENTS.md",
              name: "AGENTS.md",
              path: "AGENTS.md",
            },
          ],
          additionalPermissions: {
            network: null,
            fileSystem: {
              read: null,
              write: ["C:\\repo"],
            },
          },
        },
      }),
    ).toBe("mutating");
  });

  test("keeps unknown shell command actions unknown", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          commandActions: [
            {
              type: "unknown",
              command: "rm -rf build",
            },
          ],
        },
      }),
    ).toBe("unknown");
  });

  test("does not infer mutation from raw command text without structured actions", () => {
    expect(
      classifyCodexCommandRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        params: {
          command: "rm -rf build",
          commandActions: null,
        },
      }),
    ).toBe("unknown");
  });
});
