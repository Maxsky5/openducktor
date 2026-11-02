import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { workspaces } from "../../adapters/sqlite/sqlite-host-settings-schema";
import { workspaceSessions } from "../../adapters/sqlite/sqlite-workspace-session-schema";
import { encodeWorkspaceSessionRecord } from "../../adapters/sqlite/sqlite-workspace-session-reads";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import {
  workspaceSessionCatalog,
  workspaceSessionOwnership,
} from "../../test-support/workspace-session-ownership";
import { createWorkspaceSessionRuntimePersistence } from "../../application/workspaces/workspace-session-runtime-persistence";
import { createWorkspaceSessionOperationGate } from "../../application/workspaces/workspace-session-operation-gate";
import { resolveOwnedSessionRoot } from "../../application/agent-sessions/session-owner-resolution";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";

test("duplicate legacy native bindings keep selected metadata scoped and fan physical activity out to each saved association", async () => {
  const database = await createSqliteTaskStoreHarness();
  const store = createSqliteWorkspaceSessionStore(database);
  const scope = { workspaceId: database.workspaceId, repoPath: database.repoPath };
  const other = { ...scope, workspaceId: "other" };
  const original: WorkspaceSession = {
    id: "original",
    runtimeKind: "claude",
    externalSessionId: "native",
    executionTarget: { kind: "local_repo_root", workingDirectory: scope.repoPath },
    roleSnapshot: { id: "one", name: "One", systemPrompt: "Original instructions" },
    selectedModel: { runtimeKind: "claude", providerId: "anthropic", modelId: "one" },
    generatedTitle: null,
    manualTitle: "Original title",
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  const duplicate: WorkspaceSession = {
    ...original,
    id: "duplicate",
    manualTitle: "Other title",
    roleSnapshot: { id: "two", name: "Two", systemPrompt: "Other instructions" },
    selectedModel: { runtimeKind: "claude", providerId: "anthropic", modelId: "two" },
  };
  await Effect.runPromise(
    store.create({ ...scope, session: original, ownershipScope: workspaceSessionOwnership(scope) }),
  );
  // Migration preserves these existing bindings; a new ownership claim cannot create them.
  await Effect.runPromise(
    database.withHostDatabase("test.legacy-bindings", (session) =>
      session.transaction("test.legacy-bindings", (transaction) =>
        Effect.gen(function* () {
          const [workspace] = yield* transaction.execute(
            (db) =>
              db.select().from(workspaces).where(eq(workspaces.workspaceId, scope.workspaceId)),
            "test.workspace",
          );
          if (!workspace) return yield* Effect.die("Missing fixture workspace");
          yield* transaction.execute(
            (db) => db.insert(workspaces).values({ ...workspace, workspaceId: other.workspaceId }),
            "test.other-workspace",
          );
          yield* transaction.execute(
            (db) =>
              db
                .insert(workspaceSessions)
                .values(encodeWorkspaceSessionRecord(other.workspaceId, duplicate)),
            "test.duplicate",
          );
        }),
      ),
    ),
  );
  const catalog = workspaceSessionCatalog(scope);
  catalog.openWorkspaces.push(...workspaceSessionCatalog(other).openWorkspaces);
  const settings = { getWorkspaceCatalog: () => Effect.succeed(catalog) };
  const persistence = createWorkspaceSessionRuntimePersistence({
    store,
    settings,
    git: createGitPortTestDouble({
      canonicalizePath: (value) => Effect.succeed(value),
      isGitRepository: () => Effect.succeed(true),
      readCheckout: (value) => Effect.succeed({ root: value, commonDirectory: "/repo/.git" }),
    }),
    operationGate: createWorkspaceSessionOperationGate(),
    sessionTitleGate: createWorkspaceSessionOperationGate(),
    publishUpdated: () => Effect.void,
    reportRenameFailure: () => Effect.void,
    updateRuntimeSessionTitle: () => Effect.succeed({ status: "renamed" }),
  });
  const ref = {
    repoPath: scope.repoPath,
    runtimeKind: "claude" as const,
    externalSessionId: "native",
    workingDirectory: scope.repoPath,
  };
  try {
    const roots = await Effect.runPromise(
      createLiveSessionRootRefsReader({ store, settings })(scope.repoPath),
    );
    expect(roots.map((root) => root.sessionScope)).toEqual([
      { kind: "repository", workspaceId: scope.workspaceId },
      { kind: "repository", workspaceId: other.workspaceId },
    ]);
    expect(
      (
        await Effect.runPromise(
          resolveOwnedSessionRoot({
            ref: { ...ref, sessionScope: { kind: "repository", workspaceId: other.workspaceId } },
            roots,
            sessions: [],
          }),
        )
      ).sessionScope,
    ).toEqual({ kind: "repository", workspaceId: other.workspaceId });
    expect(
      (await Effect.runPromise(resolveOwnedSessionRoot({ ref, roots, sessions: [] }))).sessionScope,
    ).toEqual({ kind: "repository" });
    const selected = await Effect.runPromise(
      persistence.prepareResume({
        ...ref,
        resumeMode: "reattach",
        sessionScope: { kind: "repository", workspaceId: other.workspaceId },
      }),
    );
    expect(selected.input).toMatchObject({
      sessionScope: { kind: "repository", workspaceId: other.workspaceId, title: "Other title" },
      systemPrompt: "Other instructions",
      model: duplicate.selectedModel,
    });
    const physical = {
      ...ref,
      resumeMode: "reattach" as const,
      sessionScope: { kind: "repository" as const },
      systemPrompt: "Caller instructions",
    };
    expect((await Effect.runPromise(persistence.prepareResume(physical))).input).toEqual(physical);
    await Effect.runPromise(persistence.recordActivity(ref, 5_000));
    expect(
      (await Effect.runPromise(store.get({ ...scope, sessionId: original.id }))).lastActivityAt,
    ).toBe(5_000);
    expect(
      (await Effect.runPromise(store.get({ ...other, sessionId: duplicate.id }))).lastActivityAt,
    ).toBe(5_000);
    const invalid = await Effect.runPromise(
      persistence
        .prepareResume({
          ...ref,
          repoPath: "/wrong",
          resumeMode: "reattach",
          sessionScope: { kind: "repository", workspaceId: other.workspaceId },
        })
        .pipe(Effect.result),
    );
    expect(invalid._tag).toBe("Failure");
    expect(
      (await Effect.runPromise(store.get({ ...scope, sessionId: original.id }))).manualTitle,
    ).toBe("Original title");
  } finally {
    await Effect.runPromise(persistence.shutdown());
    await database.cleanup();
  }
});
