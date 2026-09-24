import { execFile } from "node:child_process";
import { promisify } from "node:util";

type ProcessCommandOptions = {
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
};

type ProcessCommandRunner = (
  command: string,
  args: string[],
  options: ProcessCommandOptions,
) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);

export const createProcessStartTimeProbe = ({
  platform,
  runCommand,
}: {
  platform: NodeJS.Platform;
  runCommand: ProcessCommandRunner;
}) => {
  return async (processId: number): Promise<number> => {
    if (processId === process.pid) {
      return Math.floor(Date.now() - process.uptime() * 1_000);
    }

    const { stdout } =
      platform === "win32"
        ? await runCommand(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `(Get-Process -Id ${processId} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
            ],
            { windowsHide: true },
          )
        : await runCommand("ps", ["-p", processId.toString(), "-o", "lstart="], {
            env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
          });
    const startedAtMs = Date.parse(platform === "win32" ? stdout.trim() : `${stdout.trim()} UTC`);
    if (!Number.isFinite(startedAtMs)) {
      throw new Error(`Could not read the start time for process ${processId}.`);
    }
    return startedAtMs;
  };
};

export const readNodeProcessStartedAtMs = createProcessStartTimeProbe({
  platform: process.platform,
  runCommand: (command, args, options) => execFileAsync(command, args, options),
});
