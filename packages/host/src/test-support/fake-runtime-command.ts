import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { link, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeCheckedExecutable } from "./checked-executable";

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * On macOS, one wrapper for every fake runtime command, checked while this module loads. Each
 * command is a hard link to it, so it shares that check, as `writeCheckedExecutable` explains. A
 * file beside the link names the script and the pid file. The wrapper lives in the user temp
 * folder, because the test preload removes the temp folder of the worker after each file.
 */
const createRuntimeWrapper = async (): Promise<string> => {
  const folder = await mkdtemp(
    join(
      execFileSync("getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim(),
      "odt-fake-runtime-",
    ),
  );
  process.once("exit", () => rmSync(folder, { force: true, recursive: true }));
  const wrapper = join(folder, "runtime");
  await writeCheckedExecutable(
    wrapper,
    `#!/bin/sh\n. "$0.env"\n[ -z "$ODT_FAKE_RUNTIME_PID_PATH" ] || echo $$ > "$ODT_FAKE_RUNTIME_PID_PATH"\nexec "$ODT_FAKE_RUNTIME" "$(dirname "$0")/$ODT_FAKE_RUNTIME_SCRIPT" "$@"\n`,
  );
  return wrapper;
};
const runtimeWrapper = process.platform === "darwin" ? await createRuntimeWrapper() : null;

/**
 * Writes an executable that runs `scriptName` with the test runtime. With `pidPath`, a POSIX
 * wrapper writes its pid before the script starts. `exec` keeps that pid, so a slow script start
 * cannot hide the process from a test.
 */
export const writeFakeRuntimeCommand = async (
  root: string,
  commandName: string,
  scriptName: string,
  pidPath?: string,
): Promise<string> => {
  const executable = join(root, process.platform === "win32" ? `${commandName}.cmd` : commandName);

  if (process.platform === "win32") {
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "%~dp0${scriptName}" %*\r\n`);
    return executable;
  }
  if (runtimeWrapper !== null) {
    await link(runtimeWrapper, executable);
    await writeFile(
      `${executable}.env`,
      `ODT_FAKE_RUNTIME=${shellQuote(process.execPath)}\nODT_FAKE_RUNTIME_SCRIPT=${shellQuote(scriptName)}\nODT_FAKE_RUNTIME_PID_PATH=${shellQuote(pidPath ?? "")}\n`,
    );
    return executable;
  }
  await writeCheckedExecutable(
    executable,
    `#!/bin/sh\n${pidPath ? `echo $$ > ${shellQuote(pidPath)}\n` : ""}exec ${shellQuote(process.execPath)} "$(dirname "$0")/${scriptName}" "$@"\n`,
  );
  return executable;
};
