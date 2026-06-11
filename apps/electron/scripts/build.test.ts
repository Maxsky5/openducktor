import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copySqliteTaskStoreMigrations, resolveSqliteTaskStoreMigrationCopyPlan } from "./build";

describe("Electron build", () => {
  it("places SQLite task-store migrations next to the bundled main process", () => {
    expect(
      resolveSqliteTaskStoreMigrationCopyPlan({
        electronPackageRoot: "/workspace/apps/electron",
        workspaceRoot: "/workspace",
      }),
    ).toEqual({
      sourceDirectory: "/workspace/packages/host/src/adapters/sqlite/drizzle",
      targetDirectory: "/workspace/apps/electron/dist/drizzle",
    });
  });

  it("copies the generated SQLite task-store migration folder", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-build-"));
    const sourceDirectory = join(tempDirectory, "source");
    const targetDirectory = join(tempDirectory, "target");

    try {
      await mkdir(join(sourceDirectory, "meta"), { recursive: true });
      await writeFile(join(sourceDirectory, "0000_create_task_store_tables.sql"), "create table");
      await writeFile(join(sourceDirectory, "meta", "_journal.json"), "{}");

      await copySqliteTaskStoreMigrations({ sourceDirectory, targetDirectory });

      await expect(
        readFile(join(targetDirectory, "0000_create_task_store_tables.sql"), "utf8"),
      ).resolves.toBe("create table");
      await expect(readFile(join(targetDirectory, "meta", "_journal.json"), "utf8")).resolves.toBe(
        "{}",
      );
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });
});
