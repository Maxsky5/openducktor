import { appendFileSync, type Dirent, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Data } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";

export type OpenDucktorLogSurface = "electron" | "web";

export type OpenDucktorDailyLogWriter = {
  append(recordedAt: Date, record: string): void;
};

type OpenDucktorDailyLogWriterOptions = {
  surface: OpenDucktorLogSurface;
  environment?: NodeJS.ProcessEnv;
  clock?: () => Date;
};

type OpenDucktorLogDirectoryEntry = Pick<Dirent, "name" | "isFile">;

export type OpenDucktorDailyLogWriterDependencies = {
  appendFile(filePath: string, contents: string): void;
  createDirectory(directoryPath: string): void;
  readDirectory(directoryPath: string): OpenDucktorLogDirectoryEntry[];
  removeFile(filePath: string): void;
  resolveBaseDirectory(environment: NodeJS.ProcessEnv): string;
};

export class OpenDucktorLogPersistenceError extends Data.TaggedError(
  "OpenDucktorLogPersistenceError",
)<{
  readonly message: string;
  readonly operation: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

const MANAGED_LOG_FILE_PATTERN = /^openducktor-(?:electron|web)-(\d{4})-(\d{2})-(\d{2})\.log$/;
const RETAINED_LOCAL_DATE_COUNT = 30;

const defaultDependencies: OpenDucktorDailyLogWriterDependencies = {
  appendFile: (filePath, contents) => appendFileSync(filePath, contents, "utf8"),
  createDirectory: (directoryPath) => mkdirSync(directoryPath, { recursive: true }),
  readDirectory: (directoryPath) => readdirSync(directoryPath, { withFileTypes: true }),
  removeFile: (filePath) => rmSync(filePath, { force: true }),
  resolveBaseDirectory: resolveOpenDucktorBaseDir,
};

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

const localDateKey = (date: Date): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const managedLogDateKey = (fileName: string): string | null => {
  const match = MANAGED_LOG_FILE_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsedDate = new Date(0);
  parsedDate.setHours(0, 0, 0, 0);
  parsedDate.setFullYear(year, month - 1, day);
  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }
  return `${yearText}-${monthText}-${dayText}`;
};

const oldestRetainedLocalDateKey = (date: Date): string => {
  const cutoff = new Date(date.getTime());
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RETAINED_LOCAL_DATE_COUNT - 1));
  return localDateKey(cutoff);
};

const logFileName = (surface: OpenDucktorLogSurface, dateKey: string): string =>
  `openducktor-${surface}-${dateKey}.log`;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const runFileOperation = <Result>(
  operation: string,
  targetPath: string,
  run: () => Result,
): Result => {
  try {
    return run();
  } catch (cause) {
    throw new OpenDucktorLogPersistenceError({
      message: `${operation} failed for ${targetPath}: ${errorMessage(cause)}`,
      operation,
      path: targetPath,
      cause,
    });
  }
};

const normalizeRecord = (record: string): string =>
  `${stripVTControlCharacters(record).replace(/(?:\r?\n)+$/u, "")}\n`;

export const createOpenDucktorDailyLogWriterWithDependencies = (
  {
    surface,
    environment = process.env,
    clock = () => new Date(),
  }: OpenDucktorDailyLogWriterOptions,
  dependencyOverrides: Partial<OpenDucktorDailyLogWriterDependencies> = {},
): OpenDucktorDailyLogWriter => {
  const dependencies: OpenDucktorDailyLogWriterDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };
  const logDirectory = path.join(dependencies.resolveBaseDirectory(environment), "logs");
  runFileOperation("openducktor.logs.create-directory", logDirectory, () =>
    dependencies.createDirectory(logDirectory),
  );

  const cleanupExpiredLogs = (currentDate: Date): void => {
    const cutoffDateKey = oldestRetainedLocalDateKey(currentDate);
    const entries = runFileOperation("openducktor.logs.read-directory", logDirectory, () =>
      dependencies.readDirectory(logDirectory),
    );
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const entryDateKey = managedLogDateKey(entry.name);
      if (!entryDateKey || entryDateKey >= cutoffDateKey) {
        continue;
      }
      const entryPath = path.join(logDirectory, entry.name);
      runFileOperation("openducktor.logs.remove-expired", entryPath, () =>
        dependencies.removeFile(entryPath),
      );
    }
  };

  const initializedAt = clock();
  cleanupExpiredLogs(initializedAt);
  let lastCleanedDateKey = localDateKey(initializedAt);

  return {
    append(recordedAt, record) {
      const recordedDateKey = localDateKey(recordedAt);
      if (recordedDateKey !== lastCleanedDateKey) {
        cleanupExpiredLogs(recordedAt);
        lastCleanedDateKey = recordedDateKey;
      }
      const filePath = path.join(logDirectory, logFileName(surface, recordedDateKey));
      runFileOperation("openducktor.logs.append", filePath, () =>
        dependencies.appendFile(filePath, normalizeRecord(record)),
      );
    },
  };
};

export const createOpenDucktorDailyLogWriter = (
  options: OpenDucktorDailyLogWriterOptions,
): OpenDucktorDailyLogWriter => createOpenDucktorDailyLogWriterWithDependencies(options);
