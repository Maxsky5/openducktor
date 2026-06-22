import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import { classifyCodexCommandRequestMutation } from "./codex-command-approvals";

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

  test("treats explicit write or network permission requests as mutating", () => {
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
            network: { enabled: true },
            fileSystem: null,
          },
        },
      }),
    ).toBe("mutating");
  });
});
