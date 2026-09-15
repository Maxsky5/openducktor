import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const currentProcessStartedAtMs = (): number =>
  Math.floor(Date.now() - process.uptime() * 1_000);

export const readProcessStartedAtMs = async (processId: number): Promise<number> => {
  if (processId === process.pid) {
    return currentProcessStartedAtMs();
  }

  const { stdout } = await (process.platform === "win32"
    ? execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${processId} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
        ],
        { windowsHide: true },
      )
    : execFileAsync("ps", ["-p", processId.toString(), "-o", "lstart="], {
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      }));
  const startedAtText = process.platform === "win32" ? stdout.trim() : `${stdout.trim()} UTC`;
  const startedAtMs = Date.parse(startedAtText);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error(`Could not read the start time for process ${processId}.`);
  }
  return startedAtMs;
};
