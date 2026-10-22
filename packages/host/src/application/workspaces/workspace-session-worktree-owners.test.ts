import { describe, expect, test } from "bun:test";
import { globalConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import { readWorkspaceSessionWorktreeOwners } from "./workspace-session-worktree-owners";

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
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});

const dependenciesFor = (
  records: WorkspaceSession[],
  nativeDirectories: ReadonlyMap<string, string>,
): Parameters<typeof readWorkspaceSessionWorktreeOwners>[0] => ({
  settingsConfig: createSettingsConfigTestDouble({ readConfig: () => Effect.succeed(null) }),
  worktreeFiles: createWorktreeFilePortTestDouble({
    resolveWorktreeRemovalPath: (directory) => Effect.succeed(directory),
  }),
  store: {
    listForWorktreeOwnership: () => Effect.succeed(records),
  },
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

      expect(
        await Effect.runPromise(readWorkspaceSessionWorktreeOwners(dependencies, scope, source)),
      ).toEqual([{ workspaceId: scope.workspaceId, sessionId: child.id, title: "child" }]);
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
      await Effect.runPromise(
        readWorkspaceSessionWorktreeOwners(
          dependenciesFor(records, nativeDirectories),
          scope,
          source,
        ),
      ),
    ).toEqual([
      { workspaceId: scope.workspaceId, sessionId: middle.id, title: "middle" },
      { workspaceId: scope.workspaceId, sessionId: child.id, title: "child" },
    ]);
    expect(
      await Effect.runPromise(
        readWorkspaceSessionWorktreeOwners(
          dependenciesFor(records, nativeDirectories),
          scope,
          middle,
        ),
      ),
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

    expect(
      await Effect.runPromise(readWorkspaceSessionWorktreeOwners(dependencies, scope, source)),
    ).toEqual([]);
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

    expect(
      await Effect.runPromise(readWorkspaceSessionWorktreeOwners(dependencies, scope, source)),
    ).toEqual([{ workspaceId: "closed", sessionId: child.id, title: "child" }]);
  });

  test("does not read Claude metadata for another runtime or an unbound draft", async () => {
    const source = record("source", "/worktrees/source");
    const otherRuntime = {
      ...record("other-runtime", "/worktrees/other"),
      runtimeKind: "opencode" as const,
    };
    const draft = { ...record("draft", "/worktrees/draft"), externalSessionId: null };
    const dependencies = dependenciesFor([source, otherRuntime, draft], new Map());

    expect(
      await Effect.runPromise(readWorkspaceSessionWorktreeOwners(dependencies, scope, source)),
    ).toEqual([]);
  });

  test("fails an ownership read when native metadata cannot be read", async () => {
    const source = record("source", "/worktrees/source");
    const child = { ...record("child", "/worktrees/child"), archivedAt: 2 };
    const dependencies = dependenciesFor([source, child], new Map());

    await expect(
      Effect.runPromise(readWorkspaceSessionWorktreeOwners(dependencies, scope, source)),
    ).rejects.toThrow("Restore access and retry");
  });
});
