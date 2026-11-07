import { describe, expect, test } from "bun:test";
import { type GitBranch, type TaskCard, type TaskMetadataPayload } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitRefTip } from "../../ports/git-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { TaskWorktreeOwnerReader } from "../../ports/task-worktree-owner-port";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorkspaceSettingsServiceTestDouble,
  createWorktreeFilePortTestDouble,
  noWorktreeOwners,
} from "../../test-support/service-test-doubles";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createTaskService } from "./task-service";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const worktreePath = "/worktrees/repo/task-1";

const task = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "human_review",
  priority: 2,
  issueType: "task",
  removeWorktreeOnClose: null,
  workflow: { id: "openducktor-spec-plan-build", revision: 3 },
  workflowSteps: [],
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    build: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const tip = (name: string, checkedOutPath: string | null): GitRefTip => ({
  ref: `refs/heads/${name}`,
  oid: "abc",
  treeOid: "tree",
  worktreePath: checkedOutPath,
});

const createService = ({
  current = task(),
  metadata = {},
  worktreeExists = true,
  otherExistingPaths = [],
  calls = [],
  worktreeOwners = noWorktreeOwners,
  beforeWorktreeRemoval = [],
  scriptSucceeds = true,
  transitions = [],
}: {
  current?: TaskCard;
  metadata?: Partial<TaskMetadataPayload>;
  worktreeExists?: boolean;
  otherExistingPaths?: string[];
  calls?: string[];
  worktreeOwners?: TaskWorktreeOwnerReader;
  beforeWorktreeRemoval?: string[];
  scriptSucceeds?: boolean;
  transitions?: string[];
}) => {
  const existing = new Set([...(worktreeExists ? [worktreePath] : []), ...otherExistingPaths]);
  const branches: GitBranch[] = [
    { name: "odt/task-1", isCurrent: false, isRemote: false, worktreePath },
  ];
  return createTaskService({
    taskWorkflows: builtinTaskWorkflows,
    taskStore: createTaskStoreTestDouble({
      getTask: () => Effect.succeed(current),
      getTaskMetadata: () => Effect.succeed({ artifacts: {}, agentSessions: [], ...metadata }),
      transitionTask: (transition) =>
        Effect.sync(() => {
          transitions.push(transition.status);
          return { ...current, status: transition.status };
        }),
    }),
    systemCommands: {
      resolveCommandPath: (command) => Effect.succeed(command),
      versionCommand: () => Effect.die(new Error("Unexpected version command")),
      runCommandAllowFailure: (command, args, options) =>
        Effect.sync(() => {
          calls.push(`script:${[command, ...args].join(" ")}@${options?.cwd}`);
          return scriptSucceeds
            ? { ok: true, stdout: "", stderr: "" }
            : { ok: false, exitCode: 3, stdout: "stopping services", stderr: "port 3000 is busy" };
        }),
    } satisfies SystemCommandPort,
    gitPort: createGitPortTestDouble({
      canonicalizePath: (value: string) => Effect.succeed(value),
      isGitRepository: () => Effect.succeed(true),
      readCheckout: (path: string) => Effect.succeed({ root: path, commonDirectory: "/repo/.git" }),
      isRegisteredWorktree: () => Effect.succeed(true),
      listBranches: () => Effect.succeed(branches),
      listRefTips: () =>
        Effect.succeed([tip("odt/task-1", worktreePath), tip("odt/task-10", null)]),
      getStatus: (path: string) =>
        Effect.sync(() => {
          calls.push(`status:${path}`);
          return [
            { path: "a.ts", status: "modified" as const, staged: false },
            { path: "b.ts", status: "untracked" as const, staged: false },
          ];
        }),
      removeWorktree: (_repoPath: string, path: string) =>
        Effect.sync(() => {
          calls.push(`remove-worktree:${path}`);
        }),
      deleteLocalBranch: (_repoPath: string, branch: string) =>
        Effect.sync(() => {
          calls.push(`delete-branch:${branch}`);
        }),
    }),
    settingsConfig: createSettingsConfigTestDouble({
      canonicalizePath: (value: string) => Effect.succeed(value),
      pathExists: (value: string) => Effect.succeed(existing.has(value)),
      join: (...parts: string[]) => parts.join("/"),
      resolveConfiguredPath: (value: string) => value,
    }),
    taskWorktreeService: {
      getTaskWorktree: () =>
        Effect.succeed(worktreeExists ? { workingDirectory: worktreePath } : null),
    },
    workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
      getRepoConfig: () =>
        Effect.succeed(
          repoConfigFixture({
            worktreeBasePath: "/worktrees/repo",
            hooks: { beforeWorktreeRemoval },
          }),
        ),
    }),
    worktreeOwners,
    worktreeFiles: createWorktreeFilePortTestDouble({
      resolveWorktreePath: (_repoPath: string, path: string) => path,
      resolvePathWithinRoot: (root: string, candidate: string) =>
        Effect.succeed({
          canonicalPath: candidate,
          cleanupPath: candidate,
          isSymlink: false,
          kind: candidate.startsWith(`${root}/`) ? ("descendant" as const) : ("outside" as const),
        }),
      pathIsWithinRoot: (root: string, candidate: string) =>
        Effect.succeed(candidate === root || candidate.startsWith(`${root}/`)),
      removePathIfPresent: () => Effect.void,
    }),
    terminalService: {
      acquireTaskCleanup: () =>
        Effect.sync(() => {
          calls.push("stop-terminals");
          return { closedTerminalIds: [] };
        }),
    },
  });
};

const input = { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" };

describe("task worktree cleanup impact", () => {
  test("names the worktree, its branches, and its uncommitted files", async () => {
    const impact = await Effect.runPromise(createService({}).getTaskWorktreeCleanupImpact(input));

    expect(impact).toEqual({
      worktreePaths: [worktreePath],
      branchNames: ["odt/task-1"],
      uncommittedFileCount: 2,
      mergeCandidate: true,
      branchOid: "abc",
    });
  });

  test("a task with a pending direct merge or a closed task is not a merge candidate", async () => {
    const pendingMerge = await Effect.runPromise(
      createService({
        metadata: {
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-10-01T00:00:00.000Z",
          },
        },
      }).getTaskWorktreeCleanupImpact(input),
    );
    const closed = await Effect.runPromise(
      createService({ current: task({ status: "closed" }) }).getTaskWorktreeCleanupImpact(input),
    );

    expect(pendingMerge.mergeCandidate).toBe(false);
    expect(closed.mergeCandidate).toBe(false);
  });

  test("reads no Git status when no worktree exists", async () => {
    const calls: string[] = [];
    const impact = await Effect.runPromise(
      createService({ worktreeExists: false, calls }).getTaskWorktreeCleanupImpact(input),
    );

    expect(impact).toMatchObject({ worktreePaths: [], uncommittedFileCount: 0 });
    expect(calls).toEqual([]);
  });

  test("covers the saved session worktrees that the cleanup removes", async () => {
    const plannerWorktree = "/worktrees/repo/planner-session";
    const calls: string[] = [];
    const impact = await Effect.runPromise(
      createService({
        worktreeExists: false,
        otherExistingPaths: [plannerWorktree],
        calls,
        metadata: {
          agentSessions: [
            {
              externalSessionId: "session-2",
              role: "planner",
              runtimeKind: "opencode",
              startedAt: "2026-10-01T00:00:00.000Z",
              workingDirectory: plannerWorktree,
              selectedModel: null,
            },
          ],
        },
      }).getTaskWorktreeCleanupImpact(input),
    );

    expect(impact).toMatchObject({ worktreePaths: [plannerWorktree], uncommittedFileCount: 2 });
    expect(calls).toEqual([`status:${plannerWorktree}`]);
  });
});

describe("remove the worktree of a closed task", () => {
  test("stops task terminals, then removes the worktree and the task branch", async () => {
    const calls: string[] = [];

    await Effect.runPromise(
      createService({ current: task({ status: "closed" }), calls }).removeTaskWorktree(input),
    );

    expect(calls).toEqual([
      "stop-terminals",
      `remove-worktree:${worktreePath}`,
      "delete-branch:odt/task-1",
    ]);
  });

  test("runs the before worktree removal script in the worktree right before its removal", async () => {
    const calls: string[] = [];

    await Effect.runPromise(
      createService({
        current: task({ status: "closed" }),
        calls,
        beforeWorktreeRemoval: ["docker compose down", "rm -rf .cache"],
      }).removeTaskWorktree(input),
    );

    expect(calls).toEqual([
      "stop-terminals",
      `script:docker compose down@${worktreePath}`,
      `script:rm -rf .cache@${worktreePath}`,
      `remove-worktree:${worktreePath}`,
      "delete-branch:odt/task-1",
    ]);
  });

  test("keeps the worktree and the branch when a script command fails", async () => {
    const calls: string[] = [];

    const failure = await Effect.runPromise(
      Effect.flip(
        createService({
          current: task({ status: "closed" }),
          calls,
          beforeWorktreeRemoval: ["docker compose down", "rm -rf .cache"],
          scriptSucceeds: false,
        }).removeTaskWorktree(input),
      ),
    );

    expect(failure.message).toContain(
      "Before worktree removal script command failed: docker compose down",
    );
    expect(failure.message).toContain("stopping services\nport 3000 is busy\nExit code 3.");
    expect(failure.message).toContain(`OpenDucktor kept the worktree ${worktreePath}.`);
    expect(failure.message).not.toContain("cleanup already completed");
    expect(calls).toEqual(["stop-terminals", `script:docker compose down@${worktreePath}`]);
  });

  test("rejects a task that is not closed", async () => {
    const calls: string[] = [];

    const failure = await Effect.runPromise(
      Effect.flip(createService({ calls }).removeTaskWorktree(input)),
    );

    expect(failure.message).toBe(
      "Task task-1 is not closed. Close the task to remove its worktree.",
    );
    expect(calls).toEqual([]);
  });
});

describe("close a task with worktree removal", () => {
  test("runs the before worktree removal script in the worktree right before its removal", async () => {
    const calls: string[] = [];
    const transitions: string[] = [];

    await Effect.runPromise(
      createService({ calls, transitions, beforeWorktreeRemoval: ["make clean"] }).closeTask({
        ...input,
        removeWorktree: true,
      }),
    );

    expect(calls).toEqual([
      "stop-terminals",
      `script:make clean@${worktreePath}`,
      `remove-worktree:${worktreePath}`,
      "delete-branch:odt/task-1",
    ]);
    expect(transitions).toEqual(["closed"]);
  });

  test("keeps the worktree, the branch, and the task status when a script command fails", async () => {
    const calls: string[] = [];
    const transitions: string[] = [];

    const failure = await Effect.runPromise(
      Effect.flip(
        createService({
          calls,
          transitions,
          beforeWorktreeRemoval: ["make clean"],
          scriptSucceeds: false,
        }).closeTask({ ...input, removeWorktree: true }),
      ),
    );

    expect(failure.message).toContain("Before worktree removal script command failed: make clean");
    expect(failure.message).toContain("port 3000 is busy");
    expect(calls).toEqual(["stop-terminals", `script:make clean@${worktreePath}`]);
    expect(transitions).toEqual([]);
  });

  test("does not run the script when the close keeps the worktree", async () => {
    const calls: string[] = [];

    await Effect.runPromise(
      createService({ calls, beforeWorktreeRemoval: ["make clean"] }).closeTask({
        ...input,
        removeWorktree: false,
      }),
    );

    expect(calls).toEqual(["stop-terminals"]);
  });
});
