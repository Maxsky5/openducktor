import { createHash } from "node:crypto";
import {
  type FileHandle,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { BrowserEngineState } from "@openducktor/contracts";
import { Data, Effect, Exit } from "effect";
import { z } from "zod";
import { errorMessage, hasNestedNodeErrorCode } from "../../../effect/host-errors";
import { CHROME_FOR_TESTING_VERSION, type ChromeForTestingArchive } from "./chrome-for-testing-pin";

const INSTALL_MARKER = ".openducktor-install.json";
/** Progress events go out at most once for each MiB, so a download sends about 200 events. */
const PROGRESS_STEP_BYTES = 1024 * 1024;

export class ChromeForTestingInstallError extends Data.TaggedError("ChromeForTestingInstallError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ChromeArchiveExtractor = (
  archivePath: string,
  destination: string,
) => Effect.Effect<void, ChromeForTestingInstallError>;

export type ChromeForTestingFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<Response>;

type ChromeForTestingInstallationInput = {
  readonly configRoot: string;
  readonly archive: ChromeForTestingArchive;
  readonly fetch: ChromeForTestingFetch;
  readonly extract: ChromeArchiveExtractor;
};

/** The install of the pinned version on this host. */
export type ChromeForTestingInstallation = {
  readonly archive: ChromeForTestingArchive;
  readonly executable: string;
  /** True when the pinned version passed its check on this host. */
  readonly isInstalled: Effect.Effect<boolean, ChromeForTestingInstallError>;
  /**
   * Downloads, checks, and installs the pinned version once for each host, then removes the other
   * versions. A failure or an interruption deletes the partial download.
   */
  install(
    report: (state: BrowserEngineState) => void,
  ): Effect.Effect<void, ChromeForTestingInstallError>;
};

const chromeForTestingInstallRoot = (configRoot: string): string =>
  path.join(configRoot, "browser", "chrome-for-testing");

export const createChromeForTestingInstallation = (
  input: ChromeForTestingInstallationInput,
): ChromeForTestingInstallation => {
  const { archive } = input;
  const root = chromeForTestingInstallRoot(input.configRoot);
  const versionDirectory = path.join(root, CHROME_FOR_TESTING_VERSION);
  const markerFile = path.join(versionDirectory, INSTALL_MARKER);
  const stagingDirectory = path.join(root, `.download-${CHROME_FOR_TESTING_VERSION}`);
  const archiveFile = path.join(stagingDirectory, `chrome-${archive.platform}.zip`);
  const extractDirectory = path.join(stagingDirectory, "extract");
  const executable = path.join(versionDirectory, ...archive.executable);

  const isInstalled = Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => readFile(markerFile, "utf8"),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        hasNestedNodeErrorCode(cause, "ENOENT")
          ? Effect.succeed(null)
          : Effect.fail(
              installError(
                `Could not read the Chrome for Testing install in ${versionDirectory}: ${errorMessage(cause)}`,
                cause,
              ),
            ),
      ),
    );
    if (text === null || !markerMatchesArchive(text, archive)) return false;
    return yield* Effect.tryPromise({
      try: () => stat(executable),
      catch: (cause) => cause,
    }).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        hasNestedNodeErrorCode(cause, "ENOENT")
          ? Effect.succeed(false)
          : Effect.fail(
              installError(
                `Could not check the browser file ${executable}: ${errorMessage(cause)}`,
                cause,
              ),
            ),
      ),
    );
  });

  const download = (report: (state: BrowserEngineState) => void) =>
    Effect.gen(function* () {
      // The state changes before the connection opens, so Cancel also stops a slow connection.
      report({
        kind: "downloading",
        version: CHROME_FOR_TESTING_VERSION,
        receivedBytes: 0,
        totalBytes: archive.sizeBytes,
      });
      const response = yield* Effect.tryPromise({
        try: (signal) => input.fetch(archive.url, { signal }),
        catch: (cause) =>
          installError(
            `Could not download Chrome for Testing from ${archive.url}: ${errorMessage(cause)}. Check the network connection of the host, then retry.`,
            cause,
          ),
      });
      if (!response.ok || response.body === null) {
        return yield* installError(
          `The Chrome for Testing download from ${archive.url} failed with HTTP ${response.status} ${response.statusText}. Retry later.`,
        );
      }
      const body = response.body;
      const hash = createHash("sha256");
      let receivedBytes = 0;
      let reportedBytes = 0;
      const receive = (reader: ReadableStreamDefaultReader<Uint8Array>, file: FileHandle) =>
        Effect.gen(function* () {
          while (true) {
            const chunk = yield* Effect.tryPromise({
              try: () => reader.read(),
              catch: (cause) =>
                installError(
                  `The Chrome for Testing download stopped: ${errorMessage(cause)}. Check the network connection of the host, then retry.`,
                  cause,
                ),
            });
            if (chunk.done) return;
            receivedBytes += chunk.value.byteLength;
            if (receivedBytes > archive.sizeBytes) {
              return yield* installError(
                `The Chrome for Testing download is larger than the pinned ${archive.sizeBytes} bytes, so OpenDucktor stopped it. Retry the download.`,
              );
            }
            hash.update(chunk.value);
            yield* fileOperation(`Could not write ${archiveFile}`, () => file.write(chunk.value));
            if (receivedBytes - reportedBytes >= PROGRESS_STEP_BYTES) {
              reportedBytes = receivedBytes;
              report({
                kind: "downloading",
                version: CHROME_FOR_TESTING_VERSION,
                receivedBytes,
                totalBytes: archive.sizeBytes,
              });
            }
          }
        });
      // Canceling the reader ends the response, also when the install stops early.
      yield* Effect.acquireUseRelease(
        Effect.sync(() => body.getReader()),
        (reader) =>
          Effect.acquireUseRelease(
            fileOperation(`Could not create ${archiveFile}`, () => open(archiveFile, "w")),
            (file) => receive(reader, file),
            (file) => Effect.promise(() => file.close()),
          ),
        // A stream that failed rejects the cancel. The response has ended then.
        (reader) => Effect.promise(() => reader.cancel().catch(() => undefined)),
      );
      return { receivedBytes, sha256: hash.digest("hex") };
    });

  const removeOtherVersions = Effect.gen(function* () {
    const entries = yield* fileOperation(`Could not read ${root}`, () => readdir(root));
    for (const entry of entries) {
      if (entry === CHROME_FOR_TESTING_VERSION) continue;
      const folder = path.join(root, entry);
      yield* fileOperation(
        `Chrome for Testing ${CHROME_FOR_TESTING_VERSION} is installed, but OpenDucktor could not remove the old folder ${folder}. Remove it, then retry`,
        () => rm(folder, { recursive: true, force: true }),
      );
    }
  });

  const installArchive = (report: (state: BrowserEngineState) => void) =>
    Effect.gen(function* () {
      yield* fileOperation(`Could not clear ${stagingDirectory}`, () =>
        rm(stagingDirectory, { recursive: true, force: true }),
      );
      yield* fileOperation(`Could not create ${extractDirectory}`, () =>
        mkdir(extractDirectory, { recursive: true }),
      );
      const downloaded = yield* download(report);
      report({ kind: "verifying", version: CHROME_FOR_TESTING_VERSION });
      if (downloaded.receivedBytes !== archive.sizeBytes || downloaded.sha256 !== archive.sha256) {
        return yield* installError(
          `The Chrome for Testing download does not match the pinned SHA-256 checksum (expected ${archive.sha256}, got ${downloaded.sha256}). OpenDucktor deleted the file. Retry the download.`,
        );
      }
      yield* input.extract(archiveFile, extractDirectory);
      const extractedExecutable = path.join(extractDirectory, ...archive.executable);
      yield* fileOperation(
        `The Chrome for Testing archive has no browser file ${archive.executable.join("/")}`,
        () => stat(extractedExecutable),
      );
      yield* fileOperation(`Could not write ${INSTALL_MARKER}`, () =>
        writeFile(
          path.join(extractDirectory, INSTALL_MARKER),
          JSON.stringify({
            version: CHROME_FOR_TESTING_VERSION,
            platform: archive.platform,
            sha256: archive.sha256,
          }),
        ),
      );
      yield* fileOperation(`Could not replace ${versionDirectory}`, () =>
        rm(versionDirectory, { recursive: true, force: true }),
      );
      yield* fileOperation(`Could not move the browser into ${versionDirectory}`, () =>
        rename(extractDirectory, versionDirectory),
      );
    }).pipe(
      Effect.onExit((exit) =>
        // A later install clears the folder again, so a failed delete here only leaves a temp file.
        Exit.isSuccess(exit)
          ? fileOperation(`Could not remove ${stagingDirectory}`, () =>
              rm(stagingDirectory, { recursive: true, force: true }),
            )
          : Effect.promise(() =>
              rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined),
            ),
      ),
    );

  return {
    archive,
    executable,
    isInstalled,
    install: (report) =>
      Effect.gen(function* () {
        if (!(yield* isInstalled)) {
          yield* installArchive(report);
        }
        // The old versions go only after the new version passed its check.
        yield* removeOtherVersions;
      }),
  };
};

const installMarkerSchema = z.object({
  version: z.string(),
  platform: z.string(),
  sha256: z.string(),
});

const installError = (message: string, cause?: unknown): ChromeForTestingInstallError =>
  cause === undefined
    ? new ChromeForTestingInstallError({ message })
    : new ChromeForTestingInstallError({ message, cause });

const fileOperation = <A>(message: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => installError(`${message}: ${errorMessage(cause)}`, cause),
  });

/** A marker of another version, platform, or archive means that the pinned version is not installed. */
const markerMatchesArchive = (text: string, archive: ChromeForTestingArchive): boolean => {
  try {
    const marker = installMarkerSchema.safeParse(JSON.parse(text));
    return (
      marker.success &&
      marker.data.version === CHROME_FOR_TESTING_VERSION &&
      marker.data.platform === archive.platform &&
      marker.data.sha256 === archive.sha256
    );
  } catch {
    return false;
  }
};
