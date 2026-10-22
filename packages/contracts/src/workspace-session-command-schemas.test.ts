import { describe, expect, test } from "bun:test";
import {
  effectiveWorkspaceSessionTargetBranch,
  workspaceSessionArchiveInputSchema,
  workspaceSessionBranchNameSchema,
  workspaceSessionCreateInputSchema,
  workspaceSessionForkInputSchema,
  workspaceSessionWorktreeInputSchema,
  workspaceSessionWorktreeNameSchema,
} from "./workspace-session-command-schemas";

describe("named chat worktree inputs", () => {
  test("fork destinations reuse worktree validation without accepting implicit boundaries", () => {
    const input = {
      workspaceId: "repo",
      sessionId: "source",
      forkPoint: { messageId: "reply-1" },
    };
    expect(
      workspaceSessionForkInputSchema.parse({ ...input, destination: { kind: "same_folder" } }),
    ).toEqual({ ...input, destination: { kind: "same_folder" } });
    expect(
      workspaceSessionForkInputSchema.parse({
        ...input,
        destination: { kind: "new_worktree", name: "review fork", branchName: "feature/fork" },
      }).destination,
    ).toEqual({ kind: "new_worktree", name: "review-fork", branchName: "feature/fork" });
    for (const destination of [
      { kind: "new_worktree", name: "../escape", branchName: "feature/fork" },
      { kind: "new_worktree", name: "fork", branchName: "HEAD" },
      { kind: "new_worktree", name: "fork" },
      { kind: "same_folder", workingDirectory: "/other" },
    ]) {
      expect(workspaceSessionForkInputSchema.safeParse({ ...input, destination }).success).toBe(
        false,
      );
    }
    expect(
      workspaceSessionForkInputSchema.safeParse({
        ...input,
        forkPoint: undefined,
        destination: { kind: "same_folder" },
      }).success,
    ).toBe(false);
  });

  test("creation has no uncommitted-changes confirmation field", () => {
    const input = {
      workspaceId: "repo",
      runtimeKind: "codex",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: null,
      targetBranch: { remote: "origin", branch: "main" },
      location: "local_worktree",
      worktree: { mode: "from_name", name: "review", branchName: null },
    };
    expect(workspaceSessionCreateInputSchema.parse(input)).toEqual(input);
    expect(
      workspaceSessionCreateInputSchema.safeParse({ ...input, confirmUncommittedChanges: true })
        .success,
    ).toBe(false);
  });
  test("requires explicit removal consent while omitted archive options keep Git resources", () => {
    const ref = { workspaceId: "repo", sessionId: "chat" };
    expect(workspaceSessionArchiveInputSchema.parse(ref)).toEqual({
      ...ref,
      confirmStop: false,
      removeWorktree: false,
    });
    expect(
      workspaceSessionArchiveInputSchema.parse({ ...ref, removeWorktree: true }).removeWorktree,
    ).toBe(true);
    expect(
      workspaceSessionArchiveInputSchema.safeParse({ ...ref, removeWorktree: "true" }).success,
    ).toBe(false);
  });
  test.each(["feat/add-facebook-login", "feat\\add-facebook-login", "feat add-facebook-login"])(
    "converts name separators to one safe directory component: %s",
    (name) => {
      expect(workspaceSessionWorktreeNameSchema.parse(name)).toBe("feat-add-facebook-login");
    },
  );
  test.each(["../escape", "/absolute", "C:\\absolute", ".", "", "bad:name"])(
    "rejects unsafe name %s",
    (name) => {
      expect(workspaceSessionWorktreeNameSchema.safeParse(name).success).toBe(false);
    },
  );
  test.each(["feature/chat", "my-branch", "release/v2.0", "_topic"])(
    "accepts branch %s",
    (name) => {
      expect(workspaceSessionBranchNameSchema.parse(name)).toBe(name);
    },
  );
  test.each([
    "",
    "HEAD",
    "@",
    "@{-1}",
    "-branch",
    "a..b",
    "a.lock",
    "a.lock/b",
    ".a",
    "a/.b",
    "a//b",
    "/a",
    "a/",
    "a.",
    "a b",
    "a\nb",
    "a\\b",
    "a:b",
    "a~b",
    "a^b",
    "a?b",
    "a*b",
    "a[b",
  ])("rejects branch %s", (name) => {
    expect(workspaceSessionBranchNameSchema.safeParse(name).success).toBe(false);
  });
  test("requires a branch only when reusing an existing branch", () => {
    expect(
      workspaceSessionWorktreeInputSchema.safeParse({
        mode: "from_branch",
        name: "review",
        branchName: null,
      }).success,
    ).toBe(false);
    expect(
      workspaceSessionWorktreeInputSchema.safeParse({
        mode: "from_name",
        name: "review",
        branchName: null,
      }).success,
    ).toBe(true);
    expect(
      workspaceSessionWorktreeInputSchema.safeParse({
        mode: "from_branch",
        name: "review",
        branchName: "feature/review",
      }).success,
    ).toBe(true);
  });
  test("a chat without a saved target uses the repository default that its location allows", () => {
    const saved = { branch: "release" };
    const upstream = { branch: "@{upstream}" };
    expect(effectiveWorkspaceSessionTargetBranch("local_worktree", saved, upstream)).toBe(saved);
    expect(effectiveWorkspaceSessionTargetBranch("local_repo_root", null, upstream)).toBe(upstream);
    expect(effectiveWorkspaceSessionTargetBranch("local_worktree", null, upstream)).toBeNull();
    expect(effectiveWorkspaceSessionTargetBranch("local_worktree", null, null)).toBeNull();
  });
  test("allows Tracked upstream only for the current checkout", () => {
    const input = {
      workspaceId: "repo",
      runtimeKind: "codex",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: null,
      targetBranch: { branch: "@{upstream}" },
    };
    expect(
      workspaceSessionCreateInputSchema.safeParse({ ...input, location: "local_repo_root" })
        .success,
    ).toBe(true);
    const worktree = workspaceSessionCreateInputSchema.safeParse({
      ...input,
      location: "local_worktree",
      worktree: { mode: "from_name", name: "review", branchName: null },
    });
    expect(worktree.error?.issues.map((issue) => issue.message)).toEqual([
      "Tracked upstream is available only for the current checkout.",
    ]);
    expect(
      workspaceSessionCreateInputSchema.safeParse({
        ...input,
        location: "local_repo_root",
        targetBranch: undefined,
      }).success,
    ).toBe(false);
  });
  test("requires worktree options exactly when a worktree is selected", () => {
    const input = {
      workspaceId: "repo",
      runtimeKind: "codex",
      selectedModel: null,
      customAgentRoleId: null,
      manualTitle: null,
      targetBranch: { branch: "main" },
    };
    const worktree = { mode: "from_name", name: "review", branchName: null };
    expect(
      workspaceSessionCreateInputSchema.safeParse({ ...input, location: "local_worktree" }).success,
    ).toBe(false);
    expect(
      workspaceSessionCreateInputSchema.safeParse({
        ...input,
        location: "local_worktree",
        worktree,
      }).success,
    ).toBe(true);
    expect(
      workspaceSessionCreateInputSchema.safeParse({ ...input, location: "local_repo_root" })
        .success,
    ).toBe(true);
    expect(
      workspaceSessionCreateInputSchema.safeParse({
        ...input,
        location: "local_repo_root",
        worktree,
      }).success,
    ).toBe(false);
  });
});
