import { afterAll } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/** A script run with this variable set exits before its first command. */
const WARMUP_VARIABLE = "ODT_TEST_EXECUTABLE_WARMUP";
const SHEBANG = "#!/bin/sh\n";

/**
 * Writes an executable POSIX shell script. On macOS it also runs the script once with no effect.
 *
 * macOS checks an executable file on its first run when an app, such as OpenDucktor, started the
 * process that wrote it. The check can take seconds, more than the timeout of a test, and its
 * result expires after some minutes. Write test executables while the test file loads, outside
 * the time of a test. A hard link to the file shares its check. Other platforms have no such check.
 */
export const writeCheckedExecutable = async (filePath: string, script: string): Promise<void> => {
  if (!script.startsWith(SHEBANG)) {
    throw new Error(`A test executable must start with ${JSON.stringify(SHEBANG)}.`);
  }
  await writeFile(
    filePath,
    `${SHEBANG}[ -n "$${WARMUP_VARIABLE}" ] && exit 0\n${script.slice(SHEBANG.length)}`,
  );
  await chmod(filePath, 0o755);
  if (process.platform !== "darwin") return;
  await promisify(execFile)(filePath, [], { env: { ...process.env, [WARMUP_VARIABLE]: "1" } });
};

/**
 * A temp folder for the executables that a test file writes while it loads, removed after the
 * tests of the file. The test preload removes the temp folder of the worker after each file and
 * creates it again only before the tests of the next file, so this creates it first.
 */
export const createLoadTimeFixtureFolder = async (prefix: string): Promise<string> => {
  await mkdir(tmpdir(), { recursive: true });
  const folder = await mkdtemp(path.join(tmpdir(), prefix));
  afterAll(() => rm(folder, { force: true, recursive: true }));
  return folder;
};
