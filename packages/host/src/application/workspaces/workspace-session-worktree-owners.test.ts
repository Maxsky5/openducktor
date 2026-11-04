import { describe, expect, test } from "bun:test";
import { createDefaultGlobalConfig } from "../../config/global-config";
import path from "node:path";
import { globalConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskWorktreeDirectories } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStoreScope,
  WorktreeOwnershipChat,
} from "../../ports/workspace-session-store-port";
import {
  createClaudeSessionMetadataTestDouble,
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import {
  readWorktreeOwners,
  readWorktreePathOwners,
  requireNoWorktreeOwners,
} from "./workspace-session-worktree-owners";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

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

/** The columns of a saved chat that the ownership read returns. */
const ownershipChat = (workspaceId: string, session: WorkspaceSession): WorktreeOwnershipChat => ({
  workspaceId,
  id: session.id,
  runtimeKind: session.runtimeKind,
  externalSessionId: session.externalSessionId,
  workingDirectory: session.executionTarget.workingDirectory,
  generatedTitle: session.generatedTitle,
  manualTitle: session.manualTitle,
  archivedAt: session.archivedAt,
});

/** A store that returns the chats of each requested workspace and records each read. */
const chatStore = (
  chatsFor: (workspaceId: string) => WorkspaceSession[],
  reads: string[][] = [],
) => ({
  listForWorktreeOwnership: ({
    workspaces,
  }: {
    workspaces: readonly WorkspaceSessionStoreScope[];
  }) => {
    reads.push(workspaces.map(({ workspaceId }) => workspaceId));
    return Effect.succeed(
      workspaces.flatMap(({ workspaceId }) =>
        chatsFor(workspaceId).map((session) => ownershipChat(workspaceId, session)),
      ),
    );
  },
});

const dependenciesFor = (
  records: WorkspaceSession[],
  nativeDirectories: ReadonlyMap<string, string>,
): Parameters<typeof readWorktreeOwners>[0] => ({
  settingsConfig: createSettingsConfigTestDouble({
    readConfig: () => Effect.succeed(createDefaultGlobalConfig()),
  }),
  worktreeFiles: createWorktreeFilePortTestDouble({
    resolveWorktreeRemovalPath: (directory) => Effect.succeed(directory),
  }),
  store: chatStore((workspaceId) => (workspaceId === scope.workspaceId ? records : [])),
  taskOwnership: { listOpenTasksForWorktreeOwnership: () => Effect.succeed([]) },
  claudeSessionMetadata: createClaudeSessionMetadataTestDouble((externalSessionId: string) => {
    const directory = nativeDirectories.get(externalSessionId);
    return directory === undefined
      ? Effect.fail(
          new HostOperationError({
            operation: "claude.session.metadata",
            message: `Cannot read Claude session ${externalSessionId}. Restore access and retry.`,
          }),
        )
      : Effect.succeed(directory);
  }),
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

  test("keeps the history directory of an archived fork when cleanup also removes the fork directory", async () => {
    const fork = { ...record("fork", "/worktrees/child"), archivedAt: 2 };
    const own = { ...record("own", "/worktrees/child"), archivedAt: 3 };
    const dependencies = dependenciesFor(
      [fork, own],
      new Map([
        ["native-fork", "/worktrees/parent"],
        ["native-own", "/worktrees/child"],
      ]),
    );

    const owners = await Effect.runPromise(
      readWorktreePathOwners(dependencies, scope, ["/worktrees/parent", "/worktrees/child"], {
        source: { kind: "tasks", taskIds: ["task-1"] },
        history: "required",
      }),
    );
    expect(owners.owners.historyChats).toEqual([
      { workspaceId: scope.workspaceId, sessionId: "fork", title: "fork" },
    ]);
  });

  test("a confirmation reports an unreadable history, and a required read fails on it", async () => {
    const readable = { ...record("readable", "/worktrees/child"), archivedAt: 2 };
    const unreadable = { ...record("unreadable", "/worktrees/other"), archivedAt: 3 };
    const dependencies = dependenciesFor(
      [readable, unreadable],
      new Map([["native-readable", "/worktrees/shared"]]),
    );
    const read = (history: "required" | "report") =>
      readWorktreePathOwners(dependencies, scope, ["/worktrees/shared"], {
        source: { kind: "tasks", taskIds: ["task-1"] },
        history,
      });
    const message =
      "Cannot check the native history of saved chat “unreadable” in workspace workspace. Cannot read Claude session native-unreadable. Restore access and retry.";

    expect(await Effect.runPromise(read("report"))).toEqual({
      owners: {
        checkoutWorkspaces: [],
        tasks: [],
        chats: [],
        historyChats: [
          { workspaceId: scope.workspaceId, sessionId: "readable", title: "readable" },
        ],
      },
      historyReadErrors: [message],
    });
    expect((await Effect.runPromise(Effect.flip(read("required")))).message).toBe(message);
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
            closed: repoConfigFixture({
              workspaceId: "closed",
              workspaceName: "Closed workspace",
              repoPath: "/unavailable-repo",
              closed: true,
            }),
          },
        }),
      );
    const reads: string[][] = [];
    dependencies.store = chatStore(
      (workspaceId) => (workspaceId === "closed" ? [child] : [source]),
      reads,
    );
    dependencies.worktreeFiles.resolveWorktreeRemovalPath = (directory) =>
      Effect.succeed(
        directory === "/aliases/source" ? source.executionTarget.workingDirectory : directory,
      );

    expect(await Effect.runPromise(chatOwners(dependencies, source))).toEqual([
      { workspaceId: "closed", sessionId: child.id, title: "child" },
    ]);
    // One store read covers every configured workspace.
    expect(reads).toEqual([[scope.workspaceId, "closed"]]);
  });

  test("fails when another workspace uses the worktree as its repository checkout", async () => {
    const source = record("source", "/worktrees/other-repo");
    const dependencies = dependenciesFor([source], new Map());
    dependencies.settingsConfig.readConfig = () =>
      Effect.succeed(
        globalConfigSchema.parse({
          version: 4,
          workspaces: {
            other: repoConfigFixture({
              workspaceId: "other",
              workspaceName: "Other workspace",
              repoPath: "/worktrees/other-repo",
            }),
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

  test("ignores a Claude chat whose transcript Claude deleted", async () => {
    const source = record("source", "/worktrees/source");
    const old = { ...record("old", "/repo"), archivedAt: 2 };
    const dependencies = dependenciesFor([source, old], new Map());
    dependencies.claudeSessionMetadata = createClaudeSessionMetadataTestDouble(() =>
      Effect.succeed(null),
    );

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
  const openTask = (taskId: string, ...sessionDirectories: string[]): TaskWorktreeDirectories => ({
    taskId,
    title: `Task ${taskId}`,
    sessionDirectories,
  });
  const config = globalConfigSchema.parse({
    version: 4,
    workspaces: {
      workspace: repoConfigFixture({
        workspaceId: "workspace",
        workspaceName: "Workspace",
        worktreeBasePath: "/worktrees",
      }),
      other: repoConfigFixture({
        workspaceId: "other",
        workspaceName: "Other",
        repoPath: "/other-repo",
        worktreeBasePath: "/other-worktrees",
        closed: true,
      }),
    },
  });
  const dependenciesFor = (tasksByWorkspace: Record<string, TaskWorktreeDirectories[]>) => ({
    settingsConfig: createSettingsConfigTestDouble({
      readConfig: () => Effect.succeed(config),
      resolveConfiguredPath: (value: string) => value,
      join: path.posix.join,
    }),
    worktreeFiles: createWorktreeFilePortTestDouble({
      resolveWorktreeRemovalPath: (directory: string) =>
        Effect.succeed(directory === "/aliases/shared" ? "/worktrees/shared" : directory),
    }),
    store: chatStore(() => []),
    taskOwnership: {
      listOpenTasksForWorktreeOwnership: ({
        workspaces,
      }: {
        workspaces: readonly WorkspaceSessionStoreScope[];
      }) =>
        Effect.succeed(
          workspaces.flatMap(({ workspaceId }) =>
            (tasksByWorkspace[workspaceId] ?? []).map((task) => ({ ...task, workspaceId })),
          ),
        ),
    },
    claudeSessionMetadata: createClaudeSessionMetadataTestDouble(),
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

  test("reads every owner of a task worktree except the task itself", async () => {
    const chat = record("chat", "/aliases/shared");
    const fork = { ...record("fork", "/worktrees/fork"), archivedAt: 2 };
    const dependencies = {
      ...dependenciesFor({
        workspace: [openTask("shared"), openTask("builder", "/worktrees/shared")],
      }),
      claudeSessionMetadata: createClaudeSessionMetadataTestDouble((externalSessionId: string) =>
        Effect.succeed(externalSessionId === "native-fork" ? "/worktrees/shared" : null),
      ),
    };
    dependencies.settingsConfig.readConfig = () =>
      Effect.succeed(
        globalConfigSchema.parse({
          ...config,
          workspaces: {
            ...config.workspaces,
            checkout: repoConfigFixture({
              workspaceId: "checkout",
              workspaceName: "Checkout",
              repoPath: "/aliases/shared",
            }),
          },
        }),
      );
    dependencies.store = chatStore((workspaceId) =>
      workspaceId === scope.workspaceId ? [chat, fork] : [],
    );

    const owners = await Effect.runPromise(
      readWorktreePathOwners(dependencies, scope, ["/worktrees/shared"], {
        source: { kind: "tasks", taskIds: ["shared"] },
        history: "required",
      }),
    );
    expect(owners.owners).toEqual({
      checkoutWorkspaces: ["Checkout"],
      tasks: [{ workspaceId: "workspace", taskId: "builder", title: "Task builder" }],
      chats: [{ workspaceId: scope.workspaceId, sessionId: "chat", title: "chat" }],
      historyChats: [{ workspaceId: scope.workspaceId, sessionId: "fork", title: "fork" }],
    });
  });

  test("reads native Claude history once for all chats, and only when asked", async () => {
    const chats = [
      { ...record("first", "/worktrees/first"), archivedAt: 2 },
      { ...record("second", "/worktrees/second"), archivedAt: 3 },
    ];
    const batches: string[][] = [];
    const dependencies = {
      ...dependenciesFor({}),
      claudeSessionMetadata: {
        readWorkingDirectories: (ids: readonly string[]) =>
          Effect.sync(() => {
            batches.push([...ids]);
            return new Map(
              ids.map((id) => [id, { kind: "read", directory: "/worktrees/shared" }] as const),
            );
          }),
      },
    };
    dependencies.store = chatStore((workspaceId) =>
      workspaceId === scope.workspaceId ? chats : [],
    );
    const read = (history: "none" | "required") =>
      Effect.runPromise(
        readWorktreePathOwners(dependencies, scope, ["/worktrees/shared"], {
          source: { kind: "tasks", taskIds: ["task-1"] },
          history,
        }),
      );

    expect((await read("none")).owners.historyChats).toEqual([]);
    expect(batches).toEqual([]);
    expect((await read("required")).owners.historyChats.map(({ sessionId }) => sessionId)).toEqual([
      "first",
      "second",
    ]);
    expect(batches).toEqual([["native-first", "native-second"]]);
  });

  test("a confirmation reports a Claude folder that cannot be listed, and a required read fails on it", async () => {
    const dependencies = {
      ...dependenciesFor({}),
      claudeSessionMetadata: {
        readWorkingDirectories: () =>
          Effect.fail(
            new HostOperationError({
              operation: "claude.session.metadata.readWorkingDirectory",
              message: "Cannot list the Claude transcripts: EACCES.",
            }),
          ),
      },
    };
    dependencies.store = chatStore((workspaceId) =>
      workspaceId === scope.workspaceId
        ? [{ ...record("fork", "/worktrees/fork"), archivedAt: 2 }]
        : [],
    );
    const read = (history: "report" | "required") =>
      Effect.runPromise(
        readWorktreePathOwners(dependencies, scope, ["/worktrees/shared"], {
          source: { kind: "tasks", taskIds: ["task-1"] },
          history,
        }),
      );

    expect(await read("report")).toEqual({
      owners: { checkoutWorkspaces: [], tasks: [], chats: [], historyChats: [] },
      historyReadErrors: [
        "Cannot check the native history of saved Claude chats. Cannot list the Claude transcripts: EACCES.",
      ],
    });
    await expect(read("required")).rejects.toThrow("Cannot list the Claude transcripts: EACCES.");
  });

  test("blocks removal and names each task and saved chat that needs the worktree", async () => {
    const source = record("source", "/worktrees/shared");
    const sibling = record("sibling", "/worktrees/shared");
    const dependencies = dependenciesFor({ workspace: [openTask("shared")] });
    dependencies.store = chatStore((workspaceId) =>
      workspaceId === scope.workspaceId ? [source, sibling] : [],
    );

    await expect(
      Effect.runPromise(requireNoWorktreeOwners(dependencies, scope, source)),
    ).rejects.toThrow(
      "Cannot remove this worktree. Open tasks use a removed worktree: Task shared (shared). Close these tasks first. Saved chats work in a removed worktree: “sibling”. Archive these chats first. Turn off worktree removal to archive this chat.",
    );
  });
});
