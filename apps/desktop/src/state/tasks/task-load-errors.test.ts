import { describe, expect, test } from "bun:test";
import { summarizeTaskLoadError } from "./task-load-errors";

describe("summarizeTaskLoadError", () => {
  test("returns category-specific restore guidance for missing shared databases", () => {
    const message = summarizeTaskLoadError({
      error: new Error("repo store unavailable"),
      repoStoreHealth: {
        category: "missing_shared_database",
        status: "restore_needed",
        isReady: false,
        detail: "Shared Dolt database repo_db is missing and restore is required",
        attachment: {
          path: "/repo/.beads",
          databaseName: "repo_db",
        },
        sharedServer: {
          host: "127.0.0.1",
          port: 3307,
          ownershipState: "owned_by_current_process",
        },
      },
    });

    expect(message).toContain("restore the shared database");
    expect(message).toContain("repo_db");
  });

  test("returns category-specific shared server guidance", () => {
    const message = summarizeTaskLoadError({
      error: new Error("repo store unavailable"),
      repoStoreHealth: {
        category: "shared_server_unavailable",
        status: "blocking",
        isReady: false,
        detail: "Shared Dolt server state is missing for /repo; reinitialize the repo store",
        attachment: {
          path: "/repo/.beads",
          databaseName: "repo_db",
        },
        sharedServer: {
          host: null,
          port: null,
          ownershipState: "unavailable",
        },
      },
    });

    expect(message).toContain("shared Dolt server state");
    expect(message).toContain("Task store unavailable.");
  });

  test("prefers structured repo-store health over raw error text when provided", () => {
    const message = summarizeTaskLoadError({
      error: new Error("gh auth expired"),
      repoStoreHealth: {
        category: "missing_shared_database",
        status: "restore_needed",
        isReady: false,
        detail: "Shared Dolt database repo_db is missing and restore is required",
        attachment: {
          path: "/repo/.beads",
          databaseName: "repo_db",
        },
        sharedServer: {
          host: "127.0.0.1",
          port: 3307,
          ownershipState: "owned_by_current_process",
        },
      },
    });

    expect(message).toContain("restore the shared database");
    expect(message).not.toContain("gh auth expired");
  });

  test("falls back to raw error text when no structured repo-store context exists", () => {
    const message = summarizeTaskLoadError({ error: new Error("gh auth expired") });

    expect(message).toBe("Task store unavailable. gh auth expired");
  });
});
