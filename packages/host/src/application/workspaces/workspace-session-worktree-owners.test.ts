import { describe, expect, test } from "bun:test";
import path from "node:path";
import { globalConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { OpenTaskDirectories } from "../../ports/task-repository-ports";
import {
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import { readWorktreeOwners, requireNoWorktreeOwners } from "./workspace-session-worktree-owners";

const scope = { workspaceId: "workspace", repoPath: "/repo" };

const record = (id: string, directory: string): WorkspaceSession => ({
  id,
  runtimeKind: "claude",
  externalSessionId: `native-${id}`,
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: directory,
    branchName: id,
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: id,
  targetBranch: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

const dependenciesFor = (
  records: WorkspaceSession[],
  nativeDirectories: ReadonlyMap<string, string>,
): Parameters<typeof readWorktreeOwners>[0] => ({
  settingsConfig: createSettingsConfigTestDouble({ readConfig: () => Effect.succeed(null) }),
  worktreeFiles: createWorktreeFilePortTestDouble({
    resolveWorktreeRemovalPath: (directory) => Effect.succeed(directory),
  }),
  store: {
    listForWorktreeOwnership: () => Effect.succeed(records),
  },
  taskOwnership: { listOpenTasksForWorktreeOwnership: () => Effect.succeed([]) },
  claudeSessionMetadata: {
    readWorkingDirectory: (externalSessionId: string) => {
      const directory = nativeDirectories.get(externalSessionId);
      return directory === undefined
        ? Effect.fail(
            new HostOperationError({
              operation: "claude.session.metadata",
              message: `Cannot read Claude session ${externalSessionId}. Restore access and retry.`,
            }),
          )
        : Effect.succeed(directory);
    },
  },
});

/** The saved chats that need the worktree of the source chat. */
const chatOwners = (
  dependencies: Parameters<typeof readWorktreeOwners>[0],
  source: WorkspaceSession,
) =>
  readWorktreeOwners(dependencies, scope, source).pipe(Effect.map((owners) => owners.sharedWith));

describe("workspace session worktree owners", () => {
  test.each(["active", "archived", "removed"] as const)(
    "protects a native history directory for a %s child from a fresh ownership read",
    async (state) => {
      const source = record("source", "/worktrees/source");
      const child: WorkspaceSession = {
        ...record("child", "/worktrees/child"),
        archivedAt: state === "active" ? null : 2,
        executionTarget: {
          kind: "local_worktree",
          workingDirectory: "/worktrees/child",
          branchName: "child",
          worktreeState: state === "removed" ? "removed" : "present",
        },
      };
      const dependencies = dependenciesFor(
        [source, child],
        new Map([["native-child", source.executionTarget.workingDirectory]]),
      );

      expect(await Effect.runPromise(chatOwners(dependencies, source))).toEqual([
        { workspaceId: scope.workspaceId, sessionId: child.id, title: "child" },
      ]);
    },
  );

  test("uses native history directories across a chain of reply forks", async () => {
    const source = record("source", "/worktrees/source");
    const middle = { ...record("middle", "/worktrees/middle"), archivedAt: 2 };
    const child = { ...record("child", "/worktrees/child"), archivedAt: 3 };
    const records = [source, middle, child];
    const nativeDirectories = new Map([
      ["native-source", source.executionTarget.workingDirectory],
      ["native-middle", source.executionTarget.workingDirectory],
      ["native-child", source.executionTarget.workingDirectory],
    ]);

    expect(
      await Effect.runPromise(chatOwners(dependenciesFor(records, nativeDirectories), source)),
    ).toEqual([
      { workspaceId: scope.workspaceId, sessionId: middle.id, title: "middle" },
      { workspaceId: scope.workspaceId, sessionId: child.id, title: "child" },
    ]);
    expect(
      await Effect.runPromise(chatOwners(dependenciesFor(records, nativeDirectories), middle)),
    ).toEqual([]);
  });

  test("does not keep an archived session's own execution directory through an alias", async () => {
    const source = record("source", "/worktrees/source");
    const sibling = { ...record("sibling", "/aliases/source"), archivedAt: 2 };
    const dependencies = dependenciesFor(
      [source, sibling],
      new Map([["native-sibling", source.executionTarget.workingDirectory]]),
    );
    dependencies.worktreeFiles.resolveWorktreeRemovalPath = (directory) =>
      Effect.succeed(
        directory === "/aliases/source" ? source.executionTarget.workingDirectory : directory,
      );

    expect(await Effect.runPromise(chatOwners(dependencies, source))).toEqual([]);
  });

  test("includes archived native history owners from a closed workspace through canonical aliases", async () => {
    const source = record("source", "/worktrees/source");
    const child = { ...record("child", "/removed/child"), archivedAt: 2 };
    const dependencies = dependenciesFor([], new Map([["native-child", "/aliases/source"]]));
    dependencies.settingsConfig.readConfig = () =>
      Effect.succeed(
        globalConfigSchema.parse({
          version: 4,
          workspaces: {
            closed: {
              workspaceId: "closed",
              workspaceName: "Closed workspace",
              repoPath: "/unavailable-repo",
              closed: true,
            },
          },
        }),
      );
    dependencies.store.listForWorktreeOwnership = (candidate: typeof scope) =>
      Effect.succeed(candidate.workspaceId === "closed" ? [child] : [source]);
    dependencies.worktreeFiles.resolveWorktreeRemovalPath = (directory) =>
      Effect.succeed(
        directory === "/aliases/source" ? source.executionTarget.workingDirectory : directory,
      );

    expect(await Effect.runPromise(chatOwners(dependencies, source))).toEqual([
      { workspaceId: "closed", sessionId: child.id, title: "child" },
    ]);
  });

  test("fails when another workspace uses the worktree as its repository checkout", async () => {
    const source = record("source", "/worktrees/other-repo");
    const dependencies = dependenciesFor([source], new Map());
    dependencies.settingsConfig.readConfig = () =>
      Effect.succeed(
        globalConfigSchema.parse({
          version: 4,
          workspaces: {
            other: {
              workspaceId: "other",
              workspaceName: "Other workspace",
              repoPath: "/worktrees/other-repo",
            },
          },
        }),
      );

    const failure = await Effect.runPromise(Effect.flip(chatOwners(dependencies, source)));
    expect(failure.message).toBe(
      "Cannot remove this worktree because workspace Other workspace uses it as its repository checkout. Turn off worktree removal to archive this chat.",
    );
  });

  test("does not read Claude metadata for another runtime or an unbound draft", async () => {
    const source = record("source", "/worktrees/source");
    const otherRuntime = {
      ...record("other-runtime", "/worktrees/other"),
      runtimeKind: "opencode" as const,
    };
    const draft = { ...record("draft", "/worktrees/draft"), externalSessionId: null };
    const dependencies = dependenciesFor([source, otherRuntime, draft], new Map());

    expect(await Effect.runPromise(chatOwners(dependencies, source))).toEqual([]);
  });

  test("fails an ownership read when native metadata cannot be read", async () => {
    const source = record("source", "/worktrees/source");
    const child = { ...record("child", "/worktrees/child"), archivedAt: 2 };
    const dependencies = dependenciesFor([source, child], new Map());

    await expect(Effect.runPromise(chatOwners(dependencies, source))).rejects.toThrow(
      "Restore access and retry",
    );
  });
});

describe("workspace session worktree task owners", () => {
  const openTask = (taskId: string, ...sessionDirectories: string[]): OpenTaskDirectories => ({
    taskId,
    title: `Task ${taskId}`,
    sessionDirectories,
  });
  const config = globalConfigSchema.parse({
    version: 4,
    workspaces: {
      workspace: {
        workspaceId: "workspace",
        workspaceName: "Workspace",
        repoPath: "/repo",
        worktreeBasePath: "/worktrees",
      },
      other: {
        workspaceId: "other",
        workspaceName: "Other",
        repoPath: "/other-repo",
        worktreeBasePath: "/other-worktrees",
        closed: true,
      },
    },
  });
  const dependenciesFor = (tasksByWorkspace: Record<string, OpenTaskDirectories[]>) => ({
    settingsConfig: createSettingsConfigTestDouble({
      readConfig: () => Effect.succeed(config),
      resolveConfiguredPath: (value: string) => value,
      join: path.posix.join,
    }),
    worktreeFiles: createWorktreeFilePortTestDouble({
      resolveWorktreeRemovalPath: (directory: string) =>
        Effect.succeed(directory === "/aliases/shared" ? "/worktrees/shared" : directory),
    }),
    store: {
      listForWorktreeOwnership: (_scope: typeof scope) => Effect.succeed<WorkspaceSession[]>([]),
    },
    taskOwnership: {
      listOpenTasksForWorktreeOwnership: (candidate: typeof scope) =>
        Effect.succeed(tasksByWorkspace[candidate.workspaceId] ?? []),
    },
    claudeSessionMetadata: {
      readWorkingDirectory: () => Effect.die(new Error("unexpected Claude metadata read")),
    },
  });

  test("reports open tasks whose worktree or session uses the directory, also in a closed workspace", async () => {
    const source = record("source", "/worktrees/shared");
    const dependencies = dependenciesFor({
      workspace: [openTask("shared"), openTask("unrelated", "/worktrees/elsewhere")],
      other: [openTask("builder", "/aliases/shared")],
    });

    const owners = await Effect.runPromise(readWorktreeOwners(dependencies, scope, source));
    expect(owners.taskOwners).toEqual([
      { workspaceId: "workspace", taskId: "shared", title: "Task shared" },
      { workspaceId: "other", taskId: "builder", title: "Task builder" },
    ]);
  });

  test("blocks removal and names each task and saved chat that needs the worktree", async () => {
    const source = record("source", "/worktrees/shared");
    const sibling = record("sibling", "/worktrees/shared");
    const dependencies = dependenciesFor({ workspace: [openTask("shared")] });
    dependencies.store.listForWorktreeOwnership = (candidate) =>
      Effect.succeed(candidate.workspaceId === scope.workspaceId ? [source, sibling] : []);

    await expect(
      Effect.runPromise(requireNoWorktreeOwners(dependencies, scope, source)),
    ).rejects.toThrow(
      "Cannot remove this worktree while tasks need it: Task shared (shared) and saved chats need it for files or history: sibling. Turn off worktree removal to archive this chat.",
    );
  });
});
