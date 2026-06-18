import { describe, expect, test } from "bun:test";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { SelectedSessionRuntimeTargetSource } from "./selected-session-runtime-target";
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

const createRuntimeTargetSource = (
  runtimeKind: "codex" | "opencode" | null,
): SelectedSessionRuntimeTargetSource =>
  runtimeKind
    ? {
        kind: "selected_session",
        runtimeKind,
      }
    : { kind: "selected_task" };

describe("resolveSelectedSessionRuntimeTarget", () => {
  test("uses the selected session runtime before repository defaults", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        source: createRuntimeTargetSource("opencode"),
        role: "build",
        repoSettings,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "runtime", runtimeKind: "opencode" });
  });

  test("keeps a sessionless selected task resolving while repository settings load", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        source: createRuntimeTargetSource(null),
        role: "build",
        repoSettings: null,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "resolving" });
  });

  test("uses the selected role runtime once repository settings are available", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        source: createRuntimeTargetSource(null),
        role: "build",
        repoSettings,
        isLoadingRepoSettings: false,
      }),
    ).toEqual({ kind: "runtime", runtimeKind: "codex" });
  });

  test("falls back to the repository runtime when the selected role has no runtime override", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        source: createRuntimeTargetSource(null),
        role: "qa",
        repoSettings,
        isLoadingRepoSettings: false,
      }),
    ).toEqual({ kind: "runtime", runtimeKind: "opencode" });
  });

  test("does not block an inactive selection on repository settings", () => {
    expect(
      resolveSelectedSessionRuntimeTarget({
        source: { kind: "inactive" },
        role: "build",
        repoSettings: null,
        isLoadingRepoSettings: true,
      }),
    ).toEqual({ kind: "all" });
  });
});
