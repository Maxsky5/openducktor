import "../../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import {
  createRuntimeDefinitionsContextValue,
  createRuntimeHookHarness,
} from "../../../test-support/runtime-hook-harness";
import { createRuntimeCatalogFixture } from "../../../test-support/shared-test-fixtures";
import { useSessionPromptInput } from "./use-session-prompt-input";

const catalog: AgentRuntimeCatalog = createRuntimeCatalogFixture({
  skills: {
    skills: [
      {
        id: "skill-1",
        name: "review",
        path: "/repo/.skills/review",
        description: "Review a branch",
      },
    ],
  },
});

const sessionIdentity = {
  externalSessionId: "external-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/.worktrees/chat",
};

describe("useSessionPromptInput", () => {
  test("reads the catalog of the session runtime in the session directory", async () => {
    const loadRepoRuntimeCatalog = mock(async (_ref: RuntimeWorkingDirectoryRef) => catalog);
    const harness = createRuntimeHookHarness(
      useSessionPromptInput,
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/.worktrees/chat",
        identity: sessionIdentity,
        runtimeReadinessState: "ready",
        reusablePrompts: [],
      },
      {
        runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({ loadRepoRuntimeCatalog }),
      },
    );
    try {
      await harness.mount();
      await harness.waitFor((state) => state.skills.skills.length > 0);

      expect(harness.getLatest().support.supportsSkillReferences).toBe(true);
      expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/.worktrees/chat",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("reads nothing while the runtime is not ready", async () => {
    const loadRepoRuntimeCatalog = mock(async (_ref: RuntimeWorkingDirectoryRef) => catalog);
    const harness = createRuntimeHookHarness(
      useSessionPromptInput,
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        identity: null,
        runtimeReadinessState: "checking",
        reusablePrompts: [],
      },
      {
        runtimeDefinitionsContext: createRuntimeDefinitionsContextValue({ loadRepoRuntimeCatalog }),
      },
    );
    try {
      await harness.mount();

      expect(loadRepoRuntimeCatalog).not.toHaveBeenCalled();
      expect(harness.getLatest().skills.skills).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });
});
