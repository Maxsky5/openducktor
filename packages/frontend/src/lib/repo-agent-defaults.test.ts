import { describe, expect, test } from "bun:test";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";
import {
  normalizeRepoAgentDefaultForSave,
  pickRepoAgentDefault,
  repoAgentDefaultRuntimeKindError,
  resolveConfiguredAgentRuntimeKind,
} from "./repo-agent-defaults";

const createRepoSettings = (overrides: Partial<RepoSettingsInput> = {}): RepoSettingsInput => ({
  worktreeBasePath: "",
  branchPrefix: "",
  defaultModel: null,
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
  ...overrides,
});

describe("repo-agent-defaults", () => {
  test("picks the role default before the repository default model", () => {
    const roleDefault: RepoAgentDefaultInput = {
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "",
    };
    const defaultModel: RepoAgentDefaultInput = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5.1",
      variant: "",
      profileId: "",
    };

    expect(pickRepoAgentDefault(roleDefault, defaultModel)).toBe(roleDefault);
    expect(pickRepoAgentDefault(null, defaultModel)).toBe(defaultModel);
    expect(pickRepoAgentDefault(undefined, null)).toBeNull();
  });

  test("resolves role runtime kind before repository default runtime kind", () => {
    expect(
      resolveConfiguredAgentRuntimeKind(
        createRepoSettings({
          agentDefaults: {
            spec: null,
            planner: null,
            build: {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "",
              profileId: "",
            },
            qa: null,
          },
        }),
        "build",
      ),
    ).toBe("codex");
  });

  test("falls back to the repository default model runtime kind", () => {
    expect(
      resolveConfiguredAgentRuntimeKind(
        createRepoSettings({
          defaultModel: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "",
            profileId: "",
          },
        }),
        "qa",
      ),
    ).toBe("codex");
  });

  test("keeps configured agent default runtime kinds unchanged", () => {
    expect(
      normalizeRepoAgentDefaultForSave("spec", {
        runtimeKind: "opencode",
        providerId: " openai ",
        modelId: " gpt-5 ",
        variant: " mini ",
        profileId: " spec ",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "mini",
      profileId: "spec",
    });
  });

  test("drops incomplete agent defaults when provider or model is blank", () => {
    expect(
      normalizeRepoAgentDefaultForSave("planner", {
        runtimeKind: "opencode",
        providerId: " ",
        modelId: "gpt-5",
      }),
    ).toBeUndefined();

    expect(
      normalizeRepoAgentDefaultForSave("planner", {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: " ",
      }),
    ).toBeUndefined();
  });

  test("rejects missing runtime kind when provider and model are configured", () => {
    expect(() =>
      normalizeRepoAgentDefaultForSave("build", {
        providerId: "anthropic",
        modelId: "claude-4",
      }),
    ).toThrow(repoAgentDefaultRuntimeKindError("build"));
  });
});
