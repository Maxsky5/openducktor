import { afterEach, expect, test } from "bun:test";
import { readFile, mkdir } from "node:fs/promises";
import { Effect } from "effect";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { withOtherInstallationSessionOwners } from "./sqlite-other-installation-session-owners";
import {
  createSqliteTaskStoreHarness,
  insertRawTask,
  type SqliteTaskStoreTestHarness,
} from "./sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "./sqlite-workspace-session-store";

const harnesses: SqliteTaskStoreTestHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.cleanup();
});
const setup = async () => {
  const local = await createSqliteTaskStoreHarness();
  const other = await createSqliteTaskStoreHarness();
  harnesses.push(local, other);
  const scope = { repoPath: local.repoPath, workspaceId: "fairnest" };
  const store = withOtherInstallationSessionOwners(
    createSqliteWorkspaceSessionStore(local.contextProvider),
    [other.configDir],
  );
  return { local, other, scope, store };
};

test("reads closed workflow ownership from the other installation without changing its database", async () => {
  const { other, scope, store } = await setup();
  await Effect.runPromise(
    createSqliteWorkspaceSessionStore(other.contextProvider).listActive(scope),
  );
  insertRawTask({
    databasePath: other.databasePath,
    taskId: "closed-owner",
    status: "closed",
    agentSessionsJson: JSON.stringify([
      createAgentSessionRecord({ runtimeKind: "codex", externalSessionId: "native-owned" }),
    ]),
  });
  const before = await readFile(other.databasePath);
  expect(await Effect.runPromise(store.listRuntimeOwners(scope))).toContainEqual(
    expect.objectContaining({
      kind: "task",
      taskId: "closed-owner",
      externalSessionId: "native-owned",
    }),
  );
  expect(await readFile(other.databasePath)).toEqual(before);
});

test("does not create a missing store in the other installation", async () => {
  const { other, scope, store } = await setup();
  expect(await Effect.runPromise(store.listRuntimeOwners(scope))).toEqual([]);
  await expect(readFile(other.databasePath)).rejects.toThrow("ENOENT");
});

test("surfaces an unreadable existing ownership store", async () => {
  const { other, scope, store } = await setup();
  await Effect.runPromise(
    createSqliteWorkspaceSessionStore(other.contextProvider).listActive(scope),
  );
  await other.cleanup();
  // A directory at the expected database path is an invalid existing store, not an absent one.
  await mkdir(other.databasePath, { recursive: true });
  await expect(Effect.runPromise(store.listRuntimeOwners(scope))).rejects.toThrow(
    "Cannot read OpenDucktor session ownership",
  );
});
