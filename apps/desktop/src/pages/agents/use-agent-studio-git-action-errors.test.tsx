import { describe, expect, test } from "bun:test";
import { createHookHarness as createCoreHookHarness } from "@/test-utils/react-hook-harness";
import { enableReactActEnvironment } from "./agent-studio-test-utils";
import { useAgentStudioGitActionErrors } from "./use-agent-studio-git-action-errors";

enableReactActEnvironment();

const createHookHarness = () =>
  createCoreHookHarness(() => useAgentStudioGitActionErrors(), undefined);

describe("useAgentStudioGitActionErrors", () => {
  test("keeps error buckets isolated, clears them together, and remains writable after clear", async () => {
    const harness = createHookHarness();

    await harness.mount();

    await harness.run((state) => {
      state.setCommitError("commit failed");
      state.setPushError("push failed");
    });

    expect(harness.getLatest()).toMatchObject({
      commitError: "commit failed",
      pushError: "push failed",
      rebaseError: null,
      resetError: null,
    });

    await harness.run((state) => {
      state.setRebaseError("rebase failed");
      state.setResetError("reset failed");
    });

    expect(harness.getLatest()).toMatchObject({
      commitError: "commit failed",
      pushError: "push failed",
      rebaseError: "rebase failed",
      resetError: "reset failed",
    });

    await harness.run((state) => {
      state.clearActionErrors();
    });

    expect(harness.getLatest()).toMatchObject({
      commitError: null,
      pushError: null,
      rebaseError: null,
      resetError: null,
    });

    await harness.run((state) => {
      state.setPushError("push failed again");
    });

    expect(harness.getLatest()).toMatchObject({
      commitError: null,
      pushError: "push failed again",
      rebaseError: null,
      resetError: null,
    });

    await harness.unmount();
  });
});
