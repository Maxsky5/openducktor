import { expect, mock, test } from "bun:test";
import { createProcessStartTimeProbe } from "./filesystem-task-asset-process-start";

test("reads an external Windows process start time from the PowerShell result", async () => {
  const processId = process.pid + 1;
  const startTime = "2026-09-24T16:45:00.0000000Z";
  const runCommand = mock(async () => ({ stdout: `  ${startTime}\r\n` }));
  const probe = createProcessStartTimeProbe({ platform: "win32", runCommand });

  expect(await probe(processId)).toBe(Date.parse(startTime));
  expect(runCommand).toHaveBeenCalledWith(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${processId} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ],
    { windowsHide: true },
  );
});

test("rejects an invalid external process start time", async () => {
  const processId = process.pid + 1;
  const probe = createProcessStartTimeProbe({
    platform: "win32",
    runCommand: async () => ({ stdout: "not a date" }),
  });

  await expect(probe(processId)).rejects.toThrow(
    `Could not read the start time for process ${processId}.`,
  );
});

test("reads the current process start time without an external command", async () => {
  const runCommand = mock(async () => ({ stdout: "not used" }));
  const probe = createProcessStartTimeProbe({ platform: "win32", runCommand });

  expect(await probe(process.pid)).toBeLessThanOrEqual(Date.now());
  expect(runCommand).not.toHaveBeenCalled();
});
