import { describe, expect, test } from "bun:test";
import { CODEX_APP_SERVER_SERVER_REQUEST_METHOD } from "@openducktor/contracts";
import { classifyCodexPermissionRequestMutation } from "./codex-permission-approvals";

describe("classifyCodexPermissionRequestMutation", () => {
  test("keeps network-only permission requests actionable", () => {
    expect(
      classifyCodexPermissionRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
        params: {
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
      }),
    ).toBe("unknown");
  });

  test("treats filesystem write permission requests as mutating", () => {
    expect(
      classifyCodexPermissionRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
        params: {
          permissions: {
            network: null,
            fileSystem: {
              read: null,
              write: ["/repo"],
            },
          },
        },
      }),
    ).toBe("mutating");

    expect(
      classifyCodexPermissionRequestMutation({
        method: CODEX_APP_SERVER_SERVER_REQUEST_METHOD.ITEM_PERMISSIONS_REQUEST_APPROVAL,
        params: {
          permissions: {
            network: null,
            fileSystem: {
              read: null,
              write: null,
              entries: [{ access: "write", path: { type: "path", path: "/repo/package.json" } }],
            },
          },
        },
      }),
    ).toBe("mutating");
  });
});
