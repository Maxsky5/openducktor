import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  availableRoleDefaultSelectionFor,
  roleDefaultSelectionFor,
} from "./session-start-selection";

const createRepoSettings = (
  buildDefault: RepoSettingsInput["agentDefaults"]["build"],
): RepoSettingsInput => ({
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "",
  branchPrefix: "",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: buildDefault,
    qa: null,
  },
});

describe("session-start role defaults", () => {
  test("maps a workflow role default to the generic selection shape", () => {
    expect(
      roleDefaultSelectionFor(
        createRepoSettings({
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build-agent",
        }),
        "build",
      ),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    });
  });

  test("keeps only role defaults whose runtime is available for a new session", () => {
    const settings = createRepoSettings({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "",
    });

    expect(
      availableRoleDefaultSelectionFor({
        repoSettings: settings,
        role: "build",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
  });
});
