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
import {
  createOpenDucktorDailyLogWriter,
  createOpenDucktorDailyLogWriterWithDependencies,
  type OpenDucktorDailyLogWriterDependencies,
  OpenDucktorLogPersistenceError,
} from "./openducktor-daily-log-writer";

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
  test("writes separate daily surface files under the resolved config directory", () => {
    const configDirectory = createTemporaryConfigDirectory();
    const environment = environmentFor(configDirectory);
    const recordedAt = localDate(2026, 5, 13, 23, 45, 12);
    const electronWriter = createOpenDucktorDailyLogWriter({
      surface: "electron",
      environment,
      clock: () => recordedAt,
    });
    const webWriter = createOpenDucktorDailyLogWriter({
      surface: "web",
      environment,
      clock: () => recordedAt,
    });

    electronWriter.append(recordedAt, "\u001b[31mERROR\u001b[0m electron failed\ntrace");
    webWriter.append(recordedAt, "INFO web ready\n\n");

    const logDirectory = path.join(configDirectory, "logs");
    expect(
      readFileSync(path.join(logDirectory, "openducktor-electron-2026-05-13.log"), "utf8"),
    ).toBe("ERROR electron failed\ntrace\n");
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-13.log"), "utf8")).toBe(
      "INFO web ready\n",
    );
  });

  test("appends across same-day restarts and multiple writer instances", () => {
    const configDirectory = createTemporaryConfigDirectory();
    const environment = environmentFor(configDirectory);
    const recordedAt = localDate(2026, 5, 13);
    const firstWriter = createOpenDucktorDailyLogWriter({
      surface: "electron",
      environment,
      clock: () => recordedAt,
    });
    firstWriter.append(recordedAt, "first");

    const secondWriter = createOpenDucktorDailyLogWriter({
      surface: "electron",
      environment,
      clock: () => recordedAt,
    });
    secondWriter.append(recordedAt, "second");
    firstWriter.append(recordedAt, "third");

    expect(
      readFileSync(
        path.join(configDirectory, "logs", "openducktor-electron-2026-05-13.log"),
        "utf8",
      ),
    ).toBe("first\nsecond\nthird\n");
  });

  test("routes each record by its observed local date", () => {
    const configDirectory = createTemporaryConfigDirectory();
    const beforeMidnight = localDate(2026, 5, 13, 23, 59, 59);
    const afterMidnight = localDate(2026, 5, 14, 0, 0, 0);
    const writer = createOpenDucktorDailyLogWriter({
      surface: "web",
      environment: environmentFor(configDirectory),
      clock: () => beforeMidnight,
    });

    writer.append(beforeMidnight, "before");
    writer.append(afterMidnight, "after");
    writer.append(new Date(afterMidnight.getTime() + 60 * 60 * 1000), "same local date");

    const logDirectory = path.join(configDirectory, "logs");
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-13.log"), "utf8")).toBe(
      "before\n",
    );
    expect(readFileSync(path.join(logDirectory, "openducktor-web-2026-05-14.log"), "utf8")).toBe(
      "after\nsame local date\n",
    );
  });

  test("retains the current local date and preceding 29 dates for both surfaces", () => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    mkdirSync(logDirectory, { recursive: true });
    createManagedFile(logDirectory, "openducktor-electron-2026-05-31.log");
    createManagedFile(logDirectory, "openducktor-web-2026-05-02.log");
    createManagedFile(logDirectory, "openducktor-electron-2026-05-01.log");
    createManagedFile(logDirectory, "openducktor-web-2025-12-31.log");

    createOpenDucktorDailyLogWriter({
      surface: "electron",
      environment: environmentFor(configDirectory),
      clock: () => localDate(2026, 5, 31),
    });

    expect(existsSync(path.join(logDirectory, "openducktor-electron-2026-05-31.log"))).toBeTrue();
    expect(existsSync(path.join(logDirectory, "openducktor-web-2026-05-02.log"))).toBeTrue();
    expect(existsSync(path.join(logDirectory, "openducktor-electron-2026-05-01.log"))).toBeFalse();
    expect(existsSync(path.join(logDirectory, "openducktor-web-2025-12-31.log"))).toBeFalse();
  });

  test("prunes newly expired managed files on rollover", () => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    mkdirSync(logDirectory, { recursive: true });
    createManagedFile(logDirectory, "openducktor-web-2026-05-01.log");
    const writer = createOpenDucktorDailyLogWriter({
      surface: "electron",
      environment: environmentFor(configDirectory),
      clock: () => localDate(2026, 5, 30),
    });
    expect(existsSync(path.join(logDirectory, "openducktor-web-2026-05-01.log"))).toBeTrue();

    writer.append(localDate(2026, 5, 31), "rollover");

    expect(existsSync(path.join(logDirectory, "openducktor-web-2026-05-01.log"))).toBeFalse();
  });

  test("preserves unrelated, malformed, future-dated, directory, and symlink entries", () => {
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

    createOpenDucktorDailyLogWriter({
      surface: "web",
      environment: environmentFor(configDirectory),
      clock: () => localDate(2026, 5, 31),
    });

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

  test("preserves canonical config validation failures", () => {
    expect(() =>
      createOpenDucktorDailyLogWriter({
        surface: "electron",
        environment: { OPENDUCKTOR_CONFIG_DIR: "   " },
      }),
    ).toThrow(expect.objectContaining({ _tag: "HostValidationError" }));
  });

  test.each([
    ["openducktor.logs.create-directory", "createDirectory"],
    ["openducktor.logs.read-directory", "readDirectory"],
    ["openducktor.logs.remove-expired", "removeFile"],
    ["openducktor.logs.append", "appendFile"],
  ] as const)("surfaces actionable %s failures", (operation, failingDependency) => {
    const configDirectory = createTemporaryConfigDirectory();
    const logDirectory = path.join(configDirectory, "logs");
    const recordedAt = localDate(2026, 5, 31);
    const failure = new Error(`${failingDependency} failed`);
    const dependencies: Partial<OpenDucktorDailyLogWriterDependencies> = {};
    if (failingDependency === "createDirectory") {
      dependencies.createDirectory = () => {
        throw failure;
      };
    }
    if (failingDependency === "readDirectory") {
      dependencies.readDirectory = () => {
        throw failure;
      };
    }
    if (failingDependency === "removeFile") {
      dependencies.readDirectory = () => [
        { name: "openducktor-web-2025-01-01.log", isFile: () => true },
      ];
      dependencies.removeFile = () => {
        throw failure;
      };
    }
    if (failingDependency === "appendFile") {
      dependencies.appendFile = () => {
        throw failure;
      };
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
      const writer = createWriter();
      expect(() => writer.append(recordedAt, "record")).toThrow(
        expect.objectContaining({
          _tag: "OpenDucktorLogPersistenceError",
          operation,
          path: path.join(logDirectory, "openducktor-web-2026-05-31.log"),
        }),
      );
      return;
    }

    expect(createWriter).toThrow(
      expect.objectContaining({
        _tag: "OpenDucktorLogPersistenceError",
        operation,
        path:
          failingDependency === "removeFile"
            ? path.join(logDirectory, "openducktor-web-2025-01-01.log")
            : logDirectory,
      }),
    );
    try {
      createWriter();
    } catch (error) {
      expect(error).toBeInstanceOf(OpenDucktorLogPersistenceError);
      expect(String(error)).toContain(failingDependency);
    }
  });
});
