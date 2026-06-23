import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyWebSqliteTaskStoreMigrations,
  resolveWebSqliteTaskStoreMigrationCopyPlan,
} from "./build";

describe("web package build", () => {
  it("places SQLite task-store migrations next to the bundled CLI", () => {
    const workspaceRoot = join("/", "workspace");
    const packageRoot = join(workspaceRoot, "packages", "openducktor-web");

    expect(
      resolveWebSqliteTaskStoreMigrationCopyPlan({
        packageRoot,
        workspaceRoot,
      }),
    ).toEqual({
      sourceDirectory: join(
        workspaceRoot,
        "packages",
        "host",
        "src",
        "adapters",
        "sqlite",
        "drizzle",
      ),
      targetDirectory: join(packageRoot, "dist", "drizzle"),
    });
  });

  it("copies the generated SQLite task-store migration folder", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "openducktor-web-build-"));
    const sourceDirectory = join(tempDirectory, "source");
    const targetDirectory = join(tempDirectory, "target");

    try {
      await mkdir(join(sourceDirectory, "meta"), { recursive: true });
      await writeFile(join(sourceDirectory, "0000_create_task_store_tables.sql"), "create table");
      await writeFile(join(sourceDirectory, "meta", "_journal.json"), "{}");

      await copyWebSqliteTaskStoreMigrations({ sourceDirectory, targetDirectory });

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
