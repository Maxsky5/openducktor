import { describe, expect, test } from "bun:test";
import { summarizeTaskLoadError } from "./task-load-errors";

describe("summarizeTaskLoadError", () => {
  test("returns category-specific guidance for unavailable SQLite databases", () => {
    const message = summarizeTaskLoadError({
      error: new Error("repo store unavailable"),
      repoStoreHealth: {
        category: "database_unavailable",
        status: "blocking",
        isReady: false,
        detail: "SQLite task store database is unavailable",
        databasePath: "/config/task-stores/repo/database.sqlite",
      },
    });

    expect(message).toContain("Task store unavailable.");
    expect(message).toContain("SQLite task store database is unavailable");
  });

  test("preserves unrelated thrown errors even when repo-store health is present", () => {
    const message = summarizeTaskLoadError({
      error: new Error("gh auth expired"),
      repoStoreHealth: {
        category: "database_unavailable",
        status: "blocking",
        isReady: false,
        detail: "SQLite task store database is unavailable",
        databasePath: "/config/task-stores/repo/database.sqlite",
      },
    });

    expect(message).toBe("gh auth expired");
  });

  test("falls back to raw error text when no structured repo-store context exists", () => {
    const message = summarizeTaskLoadError({ error: new Error("gh auth expired") });

    expect(message).toBe("gh auth expired");
  });

  test("keeps task-store wording for store failures without structured context", () => {
    const message = summarizeTaskLoadError({
      error: new Error("database.sqlite is not readable"),
    });

    expect(message).toContain("Task store unavailable.");
    expect(message).toContain("OpenDucktor stores tasks in ~/.openducktor/task-stores");
  });
});
