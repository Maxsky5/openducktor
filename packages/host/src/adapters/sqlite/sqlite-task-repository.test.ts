import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { HostInvariantError } from "../../effect/host-errors";
import {
  resolveSqliteTaskStoreDatabasePath,
  TASK_STORE_DATABASE_FILENAME,
} from "../../infrastructure/sqlite/sqlite-task-store-path";
import { createSqliteTaskRepository } from "./sqlite-task-repository";

const tempDirectories = new Set<string>();

const makeTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "odt-sqlite-task-store-"));
  tempDirectories.add(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (tempDirectory) =>
      rm(tempDirectory, { force: true, recursive: true }),
    ),
  );
  tempDirectories.clear();
});

const createClock = () => {
  let next = Date.parse("2026-06-10T10:00:00.000Z");
  return () => {
    const date = new Date(next);
    next += 1000;
    return date;
  };
};

const createRepository = (configDir: string, workspaceId = "fairnest") => {
  const databasePath = resolveSqliteTaskStoreDatabasePath({ configDir, workspaceId });
  const repository = createSqliteTaskRepository({
    now: createClock(),
    resolveDatabasePath: ({ workspaceId }) =>
      resolveSqliteTaskStoreDatabasePath({ configDir, workspaceId }),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed(workspaceId),
  });
  return { databasePath, repository };
};

const readDocumentCount = (databasePath: string, taskId: string, kind: string): number => {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database
      .prepare("select count(*) as count from task_documents where task_id = ? and kind = ?")
      .get(taskId, kind);
    return typeof row === "object" &&
      row !== null &&
      "count" in row &&
      typeof row.count === "number"
      ? row.count
      : 0;
  } finally {
    database.close();
  }
};

describe("resolveSqliteTaskStoreDatabasePath", () => {
  test("uses the workspace id literally under the task-stores config root", () => {
    expect(
      resolveSqliteTaskStoreDatabasePath({
        configDir: "/config",
        workspaceId: "repo-alpha",
      }),
    ).toBe(path.join("/config", "task-stores", "repo-alpha", TASK_STORE_DATABASE_FILENAME));
  });

  test("rejects invalid workspace ids instead of normalizing them", () => {
    expect(() =>
      resolveSqliteTaskStoreDatabasePath({
        configDir: "/config",
        workspaceId: " Repo Alpha ",
      }),
    ).toThrow(HostInvariantError);
  });
});

describe("createSqliteTaskRepository", () => {
  test("diagnoses and initializes a workspace-scoped SQLite database", async () => {
    const configDir = await makeTempDirectory();
    const { databasePath, repository } = createRepository(configDir);

    await expect(access(databasePath)).rejects.toThrow();
    await expect(
      Effect.runPromise(repository.diagnoseRepoStore({ repoPath: "/repos/fairnest" })),
    ).resolves.toMatchObject({
      category: "healthy",
      status: "ready",
      isReady: true,
      databasePath,
    });
    await expect(access(databasePath)).resolves.toBeNull();
  });

  test("creates tasks with legacy-format repo prefixes and derives subtasks from parent ids", async () => {
    const configDir = await makeTempDirectory();
    const { repository } = createRepository(configDir);

    const parent = await Effect.runPromise(
      repository.createTask({
        repoPath: "/repos/Fair Nest",
        task: {
          title: "Parent",
          issueType: "feature",
          priority: 3,
          aiReviewEnabled: false,
          labels: [" backend ", "backend", "ui"],
        },
      }),
    );
    const child = await Effect.runPromise(
      repository.createTask({
        repoPath: "/repos/Fair Nest",
        task: {
          title: "Child",
          issueType: "task",
          priority: 2,
          aiReviewEnabled: true,
          parentId: parent.id,
        },
      }),
    );

    expect(parent).toMatchObject({
      id: "fair-nest-1",
      aiReviewEnabled: false,
      labels: ["backend", "ui"],
      subtaskIds: [],
    });
    expect(child.id).toBe("fair-nest-2");
    await expect(
      Effect.runPromise(repository.listTasks({ repoPath: "/repos/Fair Nest" })),
    ).resolves.toMatchObject([
      expect.objectContaining({ id: "fair-nest-2" }),
      expect.objectContaining({ id: "fair-nest-1", subtaskIds: ["fair-nest-2"] }),
    ]);
  });

  test("stores document history while reading the latest workflow documents", async () => {
    const configDir = await makeTempDirectory();
    const { databasePath, repository } = createRepository(configDir);
    const task = await Effect.runPromise(
      repository.createTask({
        repoPath: "/repos/fairnest",
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );

    await Effect.runPromise(
      repository.setSpecDocument({
        repoPath: "/repos/fairnest",
        taskId: task.id,
        markdown: " # First spec ",
      }),
    );
    const latestSpec = await Effect.runPromise(
      repository.setSpecDocument({
        repoPath: "/repos/fairnest",
        taskId: task.id,
        markdown: "# Second spec",
      }),
    );
    const reviewed = await Effect.runPromise(
      repository.recordQaOutcome({
        repoPath: "/repos/fairnest",
        taskId: task.id,
        status: "closed",
        markdown: "# Approved",
        verdict: "approved",
      }),
    );
    const metadata = await Effect.runPromise(
      repository.getTaskMetadata({ repoPath: "/repos/fairnest", taskId: task.id }),
    );

    expect(latestSpec).toMatchObject({
      markdown: "# Second spec",
      revision: 2,
    });
    expect(reviewed.status).toBe("closed");
    expect(metadata.spec).toMatchObject({
      markdown: "# Second spec",
      revision: 2,
    });
    expect(metadata.qaReport).toMatchObject({
      markdown: "# Approved",
      verdict: "approved",
      revision: 1,
    });
    expect(readDocumentCount(databasePath, task.id, "spec")).toBe(2);
  });

  test("clearing absent pull request or direct merge records does not clear the other delivery record", async () => {
    const configDir = await makeTempDirectory();
    const { repository } = createRepository(configDir);
    const task = await Effect.runPromise(
      repository.createTask({
        repoPath: "/repos/fairnest",
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const pullRequest = {
      providerId: "github",
      number: 42,
      url: "https://github.com/acme/fairnest/pull/42",
      state: "open" as const,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    };
    const directMerge = {
      method: "squash" as const,
      sourceBranch: "task/fairnest-1",
      targetBranch: { remote: "origin", branch: "main" },
      mergedAt: "2026-06-10T11:00:00.000Z",
    };

    await Effect.runPromise(
      repository.setPullRequest({ repoPath: "/repos/fairnest", taskId: task.id, pullRequest }),
    );
    await Effect.runPromise(
      repository.setDirectMerge({
        repoPath: "/repos/fairnest",
        taskId: task.id,
        directMerge: null,
      }),
    );
    await expect(
      Effect.runPromise(
        repository.getTaskMetadata({ repoPath: "/repos/fairnest", taskId: task.id }),
      ),
    ).resolves.toMatchObject({ pullRequest });

    await Effect.runPromise(
      repository.setDirectMerge({ repoPath: "/repos/fairnest", taskId: task.id, directMerge }),
    );
    await Effect.runPromise(
      repository.setPullRequest({
        repoPath: "/repos/fairnest",
        taskId: task.id,
        pullRequest: null,
      }),
    );
    await expect(
      Effect.runPromise(
        repository.getTaskMetadata({ repoPath: "/repos/fairnest", taskId: task.id }),
      ),
    ).resolves.toMatchObject({ directMerge });
  });
});
