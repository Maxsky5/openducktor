import { describe, expect, test } from "bun:test";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import { resolveSelectedSessionRuntimeTarget } from "./selected-session-runtime-target";

const repoSettings = {
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
    build: {
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "",
    },
    qa: null,
  },
} satisfies RepoSettingsInput;

const createSelectedSessionIdentity = (
  runtimeKind: "codex" | "opencode" | null,
): AgentSessionIdentity | null =>
  runtimeKind
    ? {
        externalSessionId: "external-1",
        runtimeKind,
        workingDirectory: "/repo/worktree",
      }
    : null;

describe("resolveSelectedSessionRuntimeTarget", () => {
  test("uses the selected session runtime before repository defaults", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        hasSelectedTask: true,
        selectedSessionIdentity: createSelectedSessionIdentity("opencode"),
        role: "build",
        repoSettings,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "runtime", runtimeKind: "opencode" });
  });

  test("keeps a sessionless selected task resolving while repository settings load", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        hasSelectedTask: true,
        selectedSessionIdentity: createSelectedSessionIdentity(null),
        role: "build",
        repoSettings: null,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "resolving" });
  });

  test("uses the selected role runtime once repository settings are available", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        hasSelectedTask: true,
        selectedSessionIdentity: createSelectedSessionIdentity(null),
        role: "build",
        repoSettings,
        isLoadingRepoSettings: false,
      }),
    ).toEqual({ kind: "runtime", runtimeKind: "codex" });
  });

  test("falls back to the repository runtime when the selected role has no runtime override", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        hasSelectedTask: true,
        selectedSessionIdentity: createSelectedSessionIdentity(null),
        role: "qa",
        repoSettings,
        isLoadingRepoSettings: false,
      }),
    ).toEqual({ kind: "runtime", runtimeKind: "opencode" });
  });

  test("does not block an inactive selection on repository settings", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        hasSelectedTask: false,
        selectedSessionIdentity: createSelectedSessionIdentity(null),
        role: "build",
        repoSettings: null,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "all" });
  });
});
