import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const benchmarkPath = path.join(import.meta.dir, "sqlite-task-store-lifecycle.ts");
const buildRoot = await mkdtemp(path.join(tmpdir(), "openducktor-sqlite-benchmark-build-"));

const run = (command: string[]): string => {
  const result = Bun.spawnSync(command, {
    cwd: packageRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (result.exitCode !== 0) {
    throw new Error(
      [`Command failed: ${command.join(" ")}`, stdout, stderr].filter(Boolean).join("\n"),
    );
  }
  return stdout;
};

try {
  const nodeEntryPath = path.join(buildRoot, "sqlite-task-store-lifecycle.js");
  const build = await Bun.build({
    entrypoints: [benchmarkPath],
    format: "esm",
    outdir: buildRoot,
    target: "node",
  });
  if (!build.success) {
    throw new Error(build.logs.map((log) => String(log)).join("\n"));
  }
  await mkdir(path.join(buildRoot, "drizzle"));
  await cp(path.join(packageRoot, "src/adapters/sqlite/drizzle"), path.join(buildRoot, "drizzle"), {
    recursive: true,
  });

  const bunResult = JSON.parse(run(["bun", benchmarkPath])) as Record<string, unknown>;
  const nodeResult = JSON.parse(run(["node", nodeEntryPath])) as Record<string, unknown>;
  const results = [bunResult, nodeResult];
  const pass = results.every((result) => {
    const gate = result.gate as { pass?: unknown } | undefined;
    return gate?.pass === true;
  });
  console.log(JSON.stringify({ gate: { pass }, results }, null, 2));
  if (!pass) {
    process.exitCode = 1;
  }
} finally {
  await rm(buildRoot, { force: true, recursive: true });
}
