import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { launchChromeProcess } from "./chrome-process";

describe("launchChromeProcess", () => {
  test.skipIf(process.platform === "win32")(
    "reports the missing libraries when the Linux loader cannot start Chrome",
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "odt-cft-launch-"));
      const executable = path.join(folder, "chrome");
      await writeFile(
        executable,
        [
          "#!/bin/sh",
          'echo "chrome: error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file or directory" >&2',
          "exit 127",
        ].join("\n"),
      );
      await chmod(executable, 0o755);

      const result = await Effect.runPromise(
        Effect.result(
          launchChromeProcess({
            executable,
            profileDirectory: path.join(folder, "profile"),
            platform: "linux",
          }),
        ),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.missingLibraries).toEqual(["libgbm.so.1"]);
        expect(result.failure.message).toContain("libgbm.so.1");
        expect(result.failure.message).toContain("sudo apt-get install -y");
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "names the profile when another browser process holds it",
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), "odt-cft-launch-"));
      const executable = path.join(folder, "chrome");
      await writeFile(
        executable,
        [
          "#!/bin/sh",
          'echo "ERROR:process_singleton_posix.cc:347] Failed to create /p/SingletonLock: File exists (17)" >&2',
          'echo "ERROR:chrome_main_delegate.cc:569] Failed to create a ProcessSingleton for your profile directory." >&2',
          "exit 21",
        ].join("\n"),
      );
      await chmod(executable, 0o755);
      const profileDirectory = path.join(folder, "profile");

      const result = await Effect.runPromise(
        Effect.result(launchChromeProcess({ executable, profileDirectory, platform: "linux" })),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toBe(
          `Another browser process uses the browser profile of this workspace in ${profileDirectory}. Another OpenDucktor app that uses the same config folder can hold it. Close that app, then reload the tab.`,
        );
      }
    },
  );

  test("reports the start error when the browser file is missing", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "odt-cft-launch-"));

    const result = await Effect.runPromise(
      Effect.result(
        launchChromeProcess({
          executable: path.join(folder, "missing-chrome"),
          profileDirectory: path.join(folder, "profile"),
          platform: process.platform,
        }),
      ),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.missingLibraries).toEqual([]);
      expect(result.failure.message).toStartWith("Chrome for Testing did not start:");
      expect(result.failure.message).toContain("missing-chrome");
    }
  });
});
