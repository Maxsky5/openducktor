import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { writeFakeRuntimeCommand } from "../../../test-support/fake-runtime-command";
import { removeTestDirectory } from "../../../test-support/temp-directory";
import { launchChromeProcess } from "./chrome-process";

async function launchWithStderr(stderr: string, exitCode: number) {
  const folder = await mkdtemp(path.join(tmpdir(), "odt-cft-launch-"));
  try {
    await writeFile(
      path.join(folder, "chrome.cjs"),
      `process.stderr.write(${JSON.stringify(stderr + "\n")});\nprocess.exitCode = ${exitCode};\n`,
    );
    const executable = await writeFakeRuntimeCommand(folder, "chrome", "chrome.cjs");
    const profileDirectory = path.join(folder, "profile");
    const failure = await Effect.runPromise(
      launchChromeProcess({ executable, profileDirectory, platform: "linux" }).pipe(Effect.flip),
    );
    return { failure, profileDirectory };
  } finally {
    await removeTestDirectory(folder);
  }
}

describe("launchChromeProcess", () => {
  test.skipIf(process.platform === "win32")(
    "reports the missing libraries when the Linux loader cannot start Chrome",
    async () => {
      const { failure } = await launchWithStderr(
        "chrome: error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file or directory",
        127,
      );
      expect(failure.missingLibraries).toEqual(["libgbm.so.1"]);
      expect(failure.message).toContain("libgbm.so.1");
      expect(failure.message).toContain("sudo apt-get install -y");
    },
  );

  test.skipIf(process.platform === "win32")(
    "names the profile when another browser process holds it",
    async () => {
      const { failure, profileDirectory } = await launchWithStderr(
        [
          "ERROR:process_singleton_posix.cc:347] Failed to create /p/SingletonLock: File exists (17)",
          "ERROR:chrome_main_delegate.cc:569] Failed to create a ProcessSingleton for your profile directory.",
        ].join("\n"),
        21,
      );
      expect(failure.message).toBe(
        `Another browser process uses the browser profile of this workspace in ${profileDirectory}. Another OpenDucktor app that uses the same config folder can hold it. Close that app, then reload the tab.`,
      );
    },
  );

  test("reports the start error when the browser file is missing", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "odt-cft-launch-"));

    try {
      const failure = await Effect.runPromise(
        launchChromeProcess({
          executable: path.join(folder, "missing-chrome"),
          profileDirectory: path.join(folder, "profile"),
          platform: process.platform,
        }).pipe(Effect.flip),
      );
      expect(failure.missingLibraries).toEqual([]);
      expect(failure.message).toStartWith("Chrome for Testing did not start:");
      expect(failure.message).toContain("missing-chrome");
    } finally {
      await removeTestDirectory(folder);
    }
  });
});
