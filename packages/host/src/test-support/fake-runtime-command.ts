import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const writeFakeRuntimeCommand = async (
  root: string,
  commandName: string,
  scriptName: string,
): Promise<string> => {
  const executable = join(root, process.platform === "win32" ? `${commandName}.cmd` : commandName);

  if (process.platform === "win32") {
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "%~dp0${scriptName}" %*\r\n`);
  } else {
    await writeFile(
      executable,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$(dirname "$0")/${scriptName}" "$@"\n`,
    );
  }

  await chmod(executable, 0o755);
  return executable;
};
