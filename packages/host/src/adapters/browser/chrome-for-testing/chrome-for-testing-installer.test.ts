import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserEngineState } from "@openducktor/contracts";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  type ChromeArchiveExtractor,
  type ChromeForTestingFetch,
  createChromeForTestingInstallation,
} from "./chrome-for-testing-installer";
import { CHROME_FOR_TESTING_VERSION, type ChromeForTestingArchive } from "./chrome-for-testing-pin";

const ARCHIVE_BYTES = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);

const archiveFor = (bytes: Uint8Array): ChromeForTestingArchive => ({
  platform: "linux64",
  url: "https://downloads.test/chrome-linux64.zip",
  sizeBytes: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  executable: ["chrome-linux64", "chrome"],
});

const streamOf = (bytes: Uint8Array, chunkSize = 256 * 1024) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });

const serve =
  (bytes: Uint8Array): ChromeForTestingFetch =>
  async () =>
    new Response(streamOf(bytes));

/** Writes the browser file that a real archive holds. */
const fakeExtract: ChromeArchiveExtractor = (_archive, destination) =>
  Effect.promise(async () => {
    await mkdir(path.join(destination, "chrome-linux64"), { recursive: true });
    await writeFile(path.join(destination, "chrome-linux64", "chrome"), "#!/bin/sh\n");
  });

const setUp = async (
  options: { fetch?: ChromeForTestingFetch; archive?: ChromeForTestingArchive } = {},
) => {
  const configRoot = await mkdtemp(path.join(tmpdir(), "odt-cft-install-"));
  const states: BrowserEngineState[] = [];
  const installation = createChromeForTestingInstallation({
    configRoot,
    archive: options.archive ?? archiveFor(ARCHIVE_BYTES),
    fetch: options.fetch ?? serve(ARCHIVE_BYTES),
    extract: fakeExtract,
  });
  return {
    configRoot,
    installation,
    states,
    // The install path is saved data on the host machine, so the test spells it out.
    root: path.join(configRoot, "browser", "chrome-for-testing"),
    install: () => installation.install((state) => states.push(state)),
  };
};

describe("createChromeForTestingInstallation", () => {
  test("downloads, checks, and installs the pinned version, then reports it as installed", async () => {
    const { installation, states, root, install } = await setUp();
    expect(await Effect.runPromise(installation.isInstalled)).toBe(false);

    await Effect.runPromise(install());

    expect(states[0]).toEqual({
      kind: "downloading",
      version: CHROME_FOR_TESTING_VERSION,
      receivedBytes: 0,
      totalBytes: ARCHIVE_BYTES.byteLength,
    });
    const progress = states.filter((state) => state.kind === "downloading");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(states.at(-1)).toEqual({ kind: "verifying", version: CHROME_FOR_TESTING_VERSION });
    expect(await Effect.runPromise(installation.isInstalled)).toBe(true);
    expect(installation.executable).toBe(
      path.join(root, CHROME_FOR_TESTING_VERSION, "chrome-linux64", "chrome"),
    );
    expect(await readdir(root)).toEqual([CHROME_FOR_TESTING_VERSION]);
  });

  test("reports downloading before the connection opens, so Cancel can stop a slow connection", async () => {
    let fetchStarted = false;
    let aborted = false;
    const { states, install } = await setUp({
      fetch: (_url, init) => {
        fetchStarted = true;
        return new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            aborted = true;
            reject(init.signal.reason);
          });
        });
      },
    });

    const fiber = Effect.runFork(install());
    while (!fetchStarted) await new Promise((resolve) => setImmediate(resolve));

    expect(states).toEqual([
      {
        kind: "downloading",
        version: CHROME_FOR_TESTING_VERSION,
        receivedBytes: 0,
        totalBytes: ARCHIVE_BYTES.byteLength,
      },
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(aborted).toBe(true);
  });

  test("removes other versions only after the new version passes its check", async () => {
    const { root, install } = await setUp();
    await mkdir(path.join(root, "120.0.0.0", "chrome-linux64"), { recursive: true });
    await mkdir(path.join(root, ".download-130.0.0.0"), { recursive: true });

    await Effect.runPromise(install());

    expect(await readdir(root)).toEqual([CHROME_FOR_TESTING_VERSION]);
  });

  test("keeps other versions when the check fails", async () => {
    const tampered = ARCHIVE_BYTES.slice();
    tampered[10] = 7;
    const { root, install, installation } = await setUp({ fetch: serve(tampered) });
    await mkdir(path.join(root, "120.0.0.0"), { recursive: true });

    const result = await Effect.runPromise(Effect.result(install()));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("does not match the pinned SHA-256 checksum");
      expect(result.failure.message).toContain("OpenDucktor deleted the file");
    }
    expect(await readdir(root)).toEqual(["120.0.0.0"]);
    expect(await Effect.runPromise(installation.isInstalled)).toBe(false);
  });

  test("fails with the network reason and deletes the partial download", async () => {
    const { root, install } = await setUp({
      fetch: async () => {
        throw new TypeError("getaddrinfo ENOTFOUND storage.googleapis.com");
      },
    });

    const result = await Effect.runPromise(Effect.result(install()));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("getaddrinfo ENOTFOUND storage.googleapis.com");
      expect(result.failure.message).toContain("Check the network connection");
    }
    expect(await readdir(root)).toEqual([]);
  });

  test("fails with the HTTP status of a refused download", async () => {
    const { install } = await setUp({
      fetch: async () => new Response("missing", { status: 404, statusText: "Not Found" }),
    });

    const result = await Effect.runPromise(Effect.result(install()));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("HTTP 404 Not Found");
    }
  });

  test("stops a download that is larger than the pin", async () => {
    const { install } = await setUp({
      archive: archiveFor(ARCHIVE_BYTES.slice(0, 1024)),
    });

    const result = await Effect.runPromise(Effect.result(install()));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("larger than the pinned 1024 bytes");
    }
  });

  test("an interrupted download leaves no file behind", async () => {
    let requested: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const { root, install } = await setUp({
      fetch: async (_url, init) => {
        requested();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(ARCHIVE_BYTES.slice(0, 1024));
              init.signal.addEventListener("abort", () => controller.error(init.signal.reason));
            },
          }),
        );
      },
    });

    const fiber = Effect.runFork(install());
    await started;
    await Bun.sleep(20);
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  test("a matching install marker skips the download", async () => {
    const { root, installation, states } = await setUp({
      fetch: async () => {
        throw new Error("No download expected.");
      },
    });
    await Effect.runPromise(fakeExtract("", path.join(root, CHROME_FOR_TESTING_VERSION)));
    await writeFile(
      path.join(root, CHROME_FOR_TESTING_VERSION, ".openducktor-install.json"),
      JSON.stringify({
        version: CHROME_FOR_TESTING_VERSION,
        platform: "linux64",
        sha256: archiveFor(ARCHIVE_BYTES).sha256,
      }),
    );

    expect(await Effect.runPromise(installation.isInstalled)).toBe(true);
    await Effect.runPromise(installation.install((state) => states.push(state)));
    expect(states).toEqual([]);
    expect(
      await readFile(
        path.join(root, CHROME_FOR_TESTING_VERSION, "chrome-linux64", "chrome"),
        "utf8",
      ),
    ).toBe("#!/bin/sh\n");
  });

  test("a marker of another archive means that the pinned version is not installed", async () => {
    const { root, installation } = await setUp();
    await Effect.runPromise(fakeExtract("", path.join(root, CHROME_FOR_TESTING_VERSION)));
    await writeFile(
      path.join(root, CHROME_FOR_TESTING_VERSION, ".openducktor-install.json"),
      JSON.stringify({ version: CHROME_FOR_TESTING_VERSION, platform: "linux64", sha256: "0" }),
    );

    expect(await Effect.runPromise(installation.isInstalled)).toBe(false);
  });
});
