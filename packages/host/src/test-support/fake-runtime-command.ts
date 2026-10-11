import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

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
  } else {
    await writeFile(
      executable,
      `#!/bin/sh\n${pidPath ? `echo $$ > ${shellQuote(pidPath)}\n` : ""}exec ${shellQuote(process.execPath)} "$(dirname "$0")/${scriptName}" "$@"\n`,
    );
  }

  await chmod(executable, 0o755);
  return executable;
};
