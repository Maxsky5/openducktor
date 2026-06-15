import { describe, expect, mock, test } from "bun:test";
import type { SessionStartWorkflowResult } from "@/features/session-start";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  buildAgentStudioSessionStartKey,
  useAgentStudioSessionStartGate,
} from "./session-start/use-agent-studio-session-start-gate";

enableReactActEnvironment();

type HookState = ReturnType<typeof useAgentStudioSessionStartGate>;

const createHookHarness = (initialScopeKey: string | null) =>
  createSharedHookHarness(useAgentStudioSessionStartGate, initialScopeKey);

const workflowResult = (externalSessionId: string): SessionStartWorkflowResult => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
  postStartActionError: null,
});

describe("useAgentStudioSessionStartGate", () => {
  test("buildAgentStudioSessionStartKey keeps in-flight start identity stable", () => {
    expect(
      buildAgentStudioSessionStartKey({
        taskId: "task-1",
        role: "qa",
        launchActionId: "qa_review",
      }),
    ).toBe("task-1:qa:qa_review");
  });

  test("shares an in-flight start promise for the same key", async () => {
    const startKey = "task-1:spec:spec_initial";
    const firstStart = createDeferred<SessionStartWorkflowResult | undefined>();
    const start = mock(() => firstStart.promise);
    const duplicateStart = mock(() => Promise.resolve(workflowResult("duplicate-session")));
    const afterStart = mock(() => Promise.resolve(workflowResult("after-session")));
    const harness = createHookHarness("workspace-1");

    await harness.mount();

    let firstPromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    let secondPromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    await harness.run((state: HookState) => {
      firstPromise = state.run(startKey, start);
      secondPromise = state.run(startKey, duplicateStart);
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(duplicateStart).not.toHaveBeenCalled();
    expect(firstPromise).toBe(secondPromise);

    firstStart.resolve(workflowResult("first-session"));
    await expect(firstPromise).resolves.toMatchObject({
      externalSessionId: "first-session",
    });

    let afterCompletionPromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    await harness.run((state: HookState) => {
      afterCompletionPromise = state.run(startKey, afterStart);
    });

    expect(afterStart).toHaveBeenCalledTimes(1);
    await expect(afterCompletionPromise).resolves.toMatchObject({
      externalSessionId: "after-session",
    });

    await harness.unmount();
  });

  test("clears in-flight starts when the scope changes", async () => {
    const startKey = "task-1:spec:spec_initial";
    const oldScopeStart = createDeferred<SessionStartWorkflowResult | undefined>();
    const startInOldScope = mock(() => oldScopeStart.promise);
    const startInNewScope = mock(() => Promise.resolve(workflowResult("new-scope-session")));
    const harness = createHookHarness("workspace-1");

    await harness.mount();

    let oldScopePromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    await harness.run((state: HookState) => {
      oldScopePromise = state.run(startKey, startInOldScope);
    });

    await harness.update("workspace-2");

    let newScopePromise: Promise<SessionStartWorkflowResult | undefined> | undefined;
    await harness.run((state: HookState) => {
      newScopePromise = state.run(startKey, startInNewScope);
    });

    expect(startInOldScope).toHaveBeenCalledTimes(1);
    expect(startInNewScope).toHaveBeenCalledTimes(1);
    expect(newScopePromise).not.toBe(oldScopePromise);
    await expect(newScopePromise).resolves.toMatchObject({
      externalSessionId: "new-scope-session",
    });

    oldScopeStart.resolve(workflowResult("old-scope-session"));
    await expect(oldScopePromise).resolves.toMatchObject({
      externalSessionId: "old-scope-session",
    });

    await harness.unmount();
  });
});
