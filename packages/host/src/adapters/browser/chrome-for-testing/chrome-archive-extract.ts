import path from "node:path";
import { Effect } from "effect";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import {
  type ChromeArchiveExtractor,
  ChromeForTestingInstallError,
} from "./chrome-for-testing-installer";

const EXTRACT_TIMEOUT_MS = 10 * 60_000;

/** Extracts the browser archive with the archive tool of the host. */
export const createSystemArchiveExtractor =
  (input: {
    readonly systemCommands: SystemCommandPort;
    readonly platform: NodeJS.Platform;
    readonly systemRoot: string | undefined;
  }): ChromeArchiveExtractor =>
  (archivePath, destination) =>
    Effect.gen(function* () {
      const tool = extractTool({
        platform: input.platform,
        systemRoot: input.systemRoot,
        archivePath,
        destination,
      });
      const resolved = yield* input.systemCommands.resolveCommandPath(tool.command).pipe(
        Effect.mapError(
          (cause) =>
            new ChromeForTestingInstallError({
              message: `Could not find ${tool.name} to extract Chrome for Testing: ${cause.message}`,
              cause,
            }),
        ),
      );
      if (resolved === null) {
        return yield* new ChromeForTestingInstallError({
          message: `OpenDucktor needs ${tool.name} to extract Chrome for Testing, but this host has no ${tool.name}. ${tool.install}`,
        });
      }
      const result = yield* input.systemCommands
        .runCommandAllowFailure(resolved, [...tool.args], { timeoutMs: EXTRACT_TIMEOUT_MS })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ChromeForTestingInstallError({
                message: `${tool.name} could not extract Chrome for Testing: ${cause.message}`,
                cause,
              }),
          ),
        );
      if (!result.ok) {
        return yield* new ChromeForTestingInstallError({
          message: `${tool.name} could not extract Chrome for Testing (exit code ${result.exitCode ?? "unknown"}): ${result.stderr.trim() || "no error output"}`,
        });
      }
    });

type ExtractTool = {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly install: string;
};

/**
 * The archive tool of the host: `unzip` on macOS and Linux, and the `tar.exe` of Windows 10 and
 * later, which reads zip files. The full path skips other `tar` programs on the Windows PATH.
 */
const extractTool = (input: {
  readonly platform: NodeJS.Platform;
  readonly systemRoot: string | undefined;
  readonly archivePath: string;
  readonly destination: string;
}): ExtractTool =>
  input.platform === "win32"
    ? {
        name: "tar.exe",
        command: path.win32.join(input.systemRoot ?? "C:\\Windows", "System32", "tar.exe"),
        args: ["-xf", input.archivePath, "-C", input.destination],
        install: "Windows 10 and later include tar.exe. Update Windows, then retry.",
      }
    : {
        name: "unzip",
        command: "unzip",
        args: ["-q", "-o", input.archivePath, "-d", input.destination],
        install:
          "Install unzip, then retry. On Debian or Ubuntu, run: sudo apt-get install -y unzip",
      };
