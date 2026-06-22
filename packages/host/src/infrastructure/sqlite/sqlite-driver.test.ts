import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tempDirectories = new Set<string>();
const sqliteInfrastructureDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostPackageRoot = path.resolve(sqliteInfrastructureDirectory, "../../..");
const repositoryRoot = path.resolve(hostPackageRoot, "../..");
const electronPackageRequire = createRequire(
  path.join(repositoryRoot, "apps", "electron", "package.json"),
);
const resolveElectronExecutablePath = (): string => String(electronPackageRequire("electron"));

const makeTempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(hostPackageRoot, ".tmp-sqlite-driver-"));
  tempDirectories.add(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(Array.from(tempDirectories, (directory) => rm(directory, { recursive: true })));
  tempDirectories.clear();
});

const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

test("openSqliteDatabase supports the Node runtime used by Electron", async () => {
  const tempDirectory = await makeTempDirectory();
  const entryPath = path.join(tempDirectory, "node-sqlite-driver-check.ts");
  const buildDirectory = path.join(tempDirectory, "build");
  const databasePath = path.join(tempDirectory, "database.sqlite");

  await writeFile(
    entryPath,
    `
      import { Effect } from "effect";
      import { openSqliteDatabase } from "../src/infrastructure/sqlite/sqlite-driver.ts";

      const databasePath = process.argv[2];
      if (!databasePath) {
        throw new Error("database path argument is required");
      }

      const database = await Effect.runPromise(openSqliteDatabase(databasePath, "node"));
      try {
        await Effect.runPromise(database.exec("create table sample (label text not null, value integer not null);"));

        const insert = await Effect.runPromise(database.prepare("insert into sample (label, value) values (?, ?)"));
        const insertResult = await Effect.runPromise(insert.run("alpha", 7));
        if (Number(insertResult.changes) !== 1) {
          throw new Error(\`expected one inserted row, got \${String(insertResult.changes)}\`);
        }

        const select = await Effect.runPromise(database.prepare("select label, value from sample"));
        const values = await Effect.runPromise(select.values());
        if (values.length !== 1 || values[0]?.[0] !== "alpha" || values[0]?.[1] !== 7) {
          throw new Error(\`unexpected array row payload: \${JSON.stringify(values)}\`);
        }

        const row = await Effect.runPromise(select.get());
        if (row?.label !== "alpha" || row.value !== 7) {
          throw new Error(\`unexpected object row payload: \${JSON.stringify(row)}\`);
        }
      } finally {
        await Effect.runPromise(database.close());
      }
    `,
  );

  const build = await Bun.build({
    entrypoints: [entryPath],
    format: "esm",
    outdir: buildDirectory,
    target: "node",
  });
  expect(build.success, build.logs.map((log) => String(log)).join("\n")).toBe(true);

  const outputPath = path.join(buildDirectory, "node-sqlite-driver-check.js");
  const electronExecutablePath = resolveElectronExecutablePath();
  const result = Bun.spawnSync([electronExecutablePath, outputPath, databasePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(
    result.exitCode,
    [decode(result.stdout), decode(result.stderr)].filter(Boolean).join("\n"),
  ).toBe(0);
});
