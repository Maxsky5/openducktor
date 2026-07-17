import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  createOpenDucktorDailyLogWriter,
  OpenDucktorLogPersistenceError,
} from "./openducktor-daily-log-writer";
import {
  createOpenDucktorDailyLogWriterWithDependencies,
  type OpenDucktorDailyLogWriterDependencies,
} from "./openducktor-daily-log-writer.internal";

const temporaryDirectories: string[] = [];

const createTemporaryConfigDirectory = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "openducktor-logs-"));
  temporaryDirectories.push(directory);
  return directory;
};

const environmentFor = (configDirectory: string): NodeJS.ProcessEnv => ({
  OPENDUCKTOR_CONFIG_DIR: configDirectory,
});

const localDate = (
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0,
): Date => new Date(year, month - 1, day, hour, minute, second);

const createManagedFile = (logDirectory: string, name: string, contents = name): void => {
  writeFileSync(path.join(logDirectory, name), contents, "utf8");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("createOpenDucktorDailyLogWriter", () => {
  test("writes separate daily surface files under the resolved config directory", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const environment = environmentFor(configDirectory);
    const recordedAt = localDate(2026, 5, 13, 23, 45, 12);
    const electronWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment,
        clock: () => recordedAt,
      }),
    );
    const webWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "web",
        environment,
        clock: () => recordedAt,
      }),
    );

    await Effect.runPromise(
      electronWriter.append(recordedAt, "\u001b[31mERROR\u001b[0m electron failed\ntrace"),
    );
    await Effect.runPromise(webWriter.append(recordedAt, "INFO web ready\n\n"));

    const logDirectory = path.join(configDirectory, "logs");
    expect(
      readFileSync(path.join(logDirectory, "openducktor-electron-2026-05-13.log"), "utf8"),
    ).toBe("ERROR electron failed\ntrace\n");
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-13.log"), "utf8")).toBe(
      "INFO web ready\n",
    );
  });

  test("appends across same-day restarts and multiple writer instances", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const environment = environmentFor(configDirectory);
    const recordedAt = localDate(2026, 5, 13);
    const firstWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment,
        clock: () => recordedAt,
      }),
    );
    await Effect.runPromise(firstWriter.append(recordedAt, "first"));

    const secondWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment,
        clock: () => recordedAt,
      }),
    );
    await Effect.runPromise(secondWriter.append(recordedAt, "second"));
    await Effect.runPromise(firstWriter.append(recordedAt, "third"));

    expect(
      readFileSync(
        path.join(configDirectory, "logs", "openducktor-electron-2026-05-13.log"),
        "utf8",
      ),
    ).toBe("first\nsecond\nthird\n");
  });

  test("awaits an asynchronous append without blocking the caller", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const recordedAt = localDate(2026, 5, 13);
    let markAppendStarted = () => {};
    const appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    let releaseAppend = () => {};
    const writer = await Effect.runPromise(
      createOpenDucktorDailyLogWriterWithDependencies(
        {
          surface: "electron",
          environment: environmentFor(configDirectory),
          clock: () => recordedAt,
        },
        {
          appendFile: () => {
            markAppendStarted();
            return new Promise<void>((resolve) => {
              releaseAppend = resolve;
            });
          },
        },
      ),
    );

    let appendSettled = false;
    const append = Effect.runPromise(writer.append(recordedAt, "record")).then(() => {
      appendSettled = true;
    });
    await appendStarted;
    await Promise.resolve();

    expect(appendSettled).toBeFalse();

    releaseAppend();
    await append;
    expect(appendSettled).toBeTrue();
  });

  test("serializes concurrent appends in call order", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const recordedAt = localDate(2026, 5, 13);
    const startedRecords: string[] = [];
    const releases: Array<() => void> = [];
    let markAppendStarted: () => void = () => {};
    let appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const writer = await Effect.runPromise(
      createOpenDucktorDailyLogWriterWithDependencies(
        {
          surface: "electron",
          environment: environmentFor(configDirectory),
          clock: () => recordedAt,
        },
        {
          appendFile: (_filePath, contents) => {
            startedRecords.push(contents);
            markAppendStarted();
            return new Promise<void>((resolve) => releases.push(resolve));
          },
        },
      ),
    );

    const first = Effect.runPromise(writer.append(recordedAt, "first"));
    await appendStarted;
    appendStarted = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const second = Effect.runPromise(writer.append(recordedAt, "second"));
    await Promise.resolve();

    expect(startedRecords).toEqual(["first\n"]);
    releases.shift()?.();
    await appendStarted;
    expect(startedRecords).toEqual(["first\n", "second\n"]);
    releases.shift()?.();
    await Promise.all([first, second]);
  });

  test("routes each record by its observed local date", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const beforeMidnight = localDate(2026, 5, 13, 23, 59, 59);
    const afterMidnight = localDate(2026, 5, 14, 0, 0, 0);
    const writer = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "web",
        environment: environmentFor(configDirectory),
        clock: () => beforeMidnight,
      }),
    );

    await Effect.runPromise(writer.append(beforeMidnight, "before"));
    await Effect.runPromise(writer.append(afterMidnight, "after"));
    await Effect.runPromise(
      writer.append(new Date(afterMidnight.getTime() + 60 * 60 * 1000), "same local date"),
    );

    const logDirectory = path.join(configDirectory, "logs");
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-13.log"), "utf8")).toBe(
      "before\n",
    );
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-14.log"), "utf8")).toBe(
      "after\nsame local date\n",
    );
  });

  test("shares one config root across surfaces, restarts, and midnight rollover", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const environment = environmentFor(configDirectory);
    const beforeMidnight = localDate(2026, 5, 13, 23, 59, 59);
    const afterMidnight = localDate(2026, 5, 14, 0, 0, 1);
    const firstElectronWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment,
        clock: () => beforeMidnight,
      }),
    );
    const webWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "web",
        environment,
        clock: () => beforeMidnight,
      }),
    );

    await Effect.runPromise(firstElectronWriter.append(beforeMidnight, "electron-before"));
    await Effect.runPromise(webWriter.append(beforeMidnight, "web-before"));

    const restartedElectronWriter = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment,
        clock: () => afterMidnight,
      }),
    );
    await Effect.runPromise(restartedElectronWriter.append(afterMidnight, "electron-after"));
    await Effect.runPromise(webWriter.append(afterMidnight, "web-after"));

    const logDirectory = path.join(configDirectory, "logs");
    expect(
      readFileSync(path.join(logDirectory, "openducktor-electron-2026-05-13.log"), "utf8"),
    ).toBe("electron-before\n");
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-13.log"), "utf8")).toBe(
      "web-before\n",
    );
    expect(
      readFileSync(path.join(logDirectory, "openducktor-electron-2026-05-14.log"), "utf8"),
    ).toBe("electron-after\n");
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-14.log"), "utf8")).toBe(
      "web-after\n",
    );
  });

  test("retains the current local date and preceding 29 dates for both surfaces", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    mkdirSync(logDirectory, { recursive: true });
    createManagedFile(logDirectory, "openducktor-electron-2026-05-31.log");
    createManagedFile(logDirectory, "openducktor-web-2026-05-02.log");
    createManagedFile(logDirectory, "openducktor-electron-2026-05-01.log");
    createManagedFile(logDirectory, "openducktor-web-2025-12-31.log");

    await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment: environmentFor(configDirectory),
        clock: () => localDate(2026, 5, 31),
      }),
    );

    expect(existsSync(path.join(logDirectory, "openducktor-electron-2026-05-31.log"))).toBeTrue();
    expect(existsSync(path.join(logDirectory, "openducktor-web-2026-05-02.log"))).toBeTrue();
    expect(existsSync(path.join(logDirectory, "openducktor-electron-2026-05-01.log"))).toBeFalse();
    expect(existsSync(path.join(logDirectory, "openducktor-web-2025-12-31.log"))).toBeFalse();
  });

  test("prunes newly expired managed files on rollover", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    mkdirSync(logDirectory, { recursive: true });
    createManagedFile(logDirectory, "openducktor-web-2026-05-01.log");
    const writer = await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment: environmentFor(configDirectory),
        clock: () => localDate(2026, 5, 30),
      }),
    );
    expect(existsSync(path.join(logDirectory, "openducktor-web-2026-05-01.log"))).toBeTrue();

    await Effect.runPromise(writer.append(localDate(2026, 5, 31), "rollover"));

    expect(existsSync(path.join(logDirectory, "openducktor-web-2026-05-01.log"))).toBeFalse();
  });

  test("preserves unrelated, malformed, future-dated, directory, and symlink entries", async () => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    mkdirSync(logDirectory, { recursive: true });
    const preservedNames = [
      "notes.txt",
      "openducktor-web-2026-02-30.log",
      "openducktor-web-2026-2-01.log",
      "openducktor-renderer-2025-01-01.log",
      "openducktor-electron-2026-06-01.log",
    ];
    for (const name of preservedNames) {
      createManagedFile(logDirectory, name);
    }
    mkdirSync(path.join(logDirectory, "openducktor-web-2025-01-01.log"));
    symlinkSync(
      path.join(logDirectory, "notes.txt"),
      path.join(logDirectory, "openducktor-electron-2025-01-01.log"),
    );

    await Effect.runPromise(
      createOpenDucktorDailyLogWriter({
        surface: "web",
        environment: environmentFor(configDirectory),
        clock: () => localDate(2026, 5, 31),
      }),
    );

    for (const name of preservedNames) {
      expect(Bun.file(path.join(logDirectory, name)).size).toBeGreaterThan(0);
    }
    expect(
      lstatSync(path.join(logDirectory, "openducktor-web-2025-01-01.log")).isDirectory(),
    ).toBeTrue();
    expect(
      lstatSync(path.join(logDirectory, "openducktor-electron-2025-01-01.log")).isSymbolicLink(),
    ).toBeTrue();
  });

  test("preserves canonical config validation failures", async () => {
    await expect(
      Effect.runPromise(
        Effect.flip(
          createOpenDucktorDailyLogWriter({
            surface: "electron",
            environment: { OPENDUCKTOR_CONFIG_DIR: "   " },
          }),
        ),
      ),
    ).resolves.toEqual(expect.objectContaining({ _tag: "HostValidationError" }));
  });

  test.each([
    ["openducktor.logs.create-directory", "createDirectory"],
    ["openducktor.logs.read-directory", "readDirectory"],
    ["openducktor.logs.remove-expired", "removeFile"],
    ["openducktor.logs.append", "appendFile"],
  ] as const)("surfaces actionable %s failures", async (operation, failingDependency) => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    const recordedAt = localDate(2026, 5, 31);
    const failure = new Error(`${failingDependency} failed`);
    const dependencies: Partial<OpenDucktorDailyLogWriterDependencies> = {};
    if (failingDependency === "createDirectory") {
      dependencies.createDirectory = () => Promise.reject(failure);
    }
    if (failingDependency === "readDirectory") {
      dependencies.readDirectory = () => Promise.reject(failure);
    }
    if (failingDependency === "removeFile") {
      dependencies.readDirectory = () =>
        Promise.resolve([{ name: "openducktor-web-2025-01-01.log", isFile: () => true }]);
      dependencies.removeFile = () => Promise.reject(failure);
    }
    if (failingDependency === "appendFile") {
      dependencies.appendFile = () => Promise.reject(failure);
    }

    const createWriter = () =>
      createOpenDucktorDailyLogWriterWithDependencies(
        {
          surface: "web",
          environment: environmentFor(configDirectory),
          clock: () => recordedAt,
        },
        dependencies,
      );

    if (failingDependency === "appendFile") {
      const writer = await Effect.runPromise(createWriter());
      await expect(
        Effect.runPromise(Effect.flip(writer.append(recordedAt, "record"))),
      ).resolves.toEqual(
        expect.objectContaining({
          _tag: "OpenDucktorLogPersistenceError",
          operation,
          path: path.join(logDirectory, "openducktor-web-2026-05-31.log"),
        }),
      );
      return;
    }

    await expect(Effect.runPromise(Effect.flip(createWriter()))).resolves.toEqual(
      expect.objectContaining({
        _tag: "OpenDucktorLogPersistenceError",
        operation,
        path:
          failingDependency === "removeFile"
            ? path.join(logDirectory, "openducktor-web-2025-01-01.log")
            : logDirectory,
      }),
    );
    const error = await Effect.runPromise(Effect.flip(createWriter()));
    expect(error).toBeInstanceOf(OpenDucktorLogPersistenceError);
    expect(String(error)).toContain(failingDependency);
  });
});
