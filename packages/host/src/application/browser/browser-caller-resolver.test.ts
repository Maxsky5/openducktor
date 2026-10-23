import { describe, expect, test } from "bun:test";
import type { BrowserTabOwner } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, HostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import { createBrowserCallerResolver } from "./browser-caller-resolver";

const input = {
  workspaceId: "repo",
  caller: { runtime: "opencode", runtimeSessionId: "ses_caller" },
} as const;

describe("createBrowserCallerResolver", () => {
  test.each([
    {
      owner: {
        kind: "task",
        taskId: "task-1",
        role: "qa",
        runtimeKind: "opencode",
        externalSessionId: "ses_root",
      },
      expected: { kind: "task", workspaceId: "repo", taskId: "task-1" },
    },
    {
      owner: {
        kind: "workspace",
        sessionId: "chat-1",
        archived: false,
        runtimeKind: "opencode",
        externalSessionId: "ses_root",
      },
      expected: { kind: "workspace_session", workspaceId: "repo", sessionId: "chat-1" },
    },
  ] satisfies { owner: RuntimeSessionOwner; expected: BrowserTabOwner }[])(
    "maps a $owner.kind root to its browser owner",
    async ({ owner, expected }) => {
      const resolver = createBrowserCallerResolver({ resolve: () => Effect.succeed(owner) });
      expect(await Effect.runPromise(resolver.resolve(input))).toEqual(expected);
    },
  );

  test("keeps the public browser error for an unmanaged session", async () => {
    const resolver = createBrowserCallerResolver({
      resolve: () =>
        Effect.fail(
          new HostValidationError({
            field: "caller",
            message:
              "The OpenCode session 'ses_caller' does not belong to a task or an active Workspace Session of this workspace.",
          }),
        ),
    });

    const error = await Effect.runPromise(Effect.flip(resolver.resolve(input)));
    expect(error).toMatchObject({
      _tag: "BrowserServiceError",
      code: "browser_unmanaged_caller",
      operation: "browser.resolveCaller",
      message:
        "Browser tools need a managed OpenDucktor session. The OpenCode session 'ses_caller' does not belong to a task or an active Workspace Session of this workspace.",
      details: { runtime: "opencode", runtimeSessionId: "ses_caller" },
    });
  });

  test.each([
    new HostValidationError({ field: "workspaceId", message: "Workspace is not configured." }),
    new HostOperationError({ operation: "session.list", message: "Runtime read failed." }),
  ])("propagates dependency errors", async (failure) => {
    const resolver = createBrowserCallerResolver({ resolve: () => Effect.fail(failure) });
    expect(await Effect.runPromise(Effect.flip(resolver.resolve(input)))).toBe(failure);
  });
});
