import { type Dirent, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RuntimeKind } from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import { isPathNotFoundError } from "../../effect/host-errors";
import type { UsageLocations, UsageReadResult } from "../../ports/usage-index-port";
import type { UsageSourceFingerprint, UsageSourceFormat } from "./usage-worker-protocol";

export type DiskSource = {
  runtime: RuntimeKind;
  path: string;
  format: UsageSourceFormat;
  fingerprint: UsageSourceFingerprint;
};

export type Discovery = {
  sources: DiskSource[];
  withoutHistory: RuntimeKind[];
  locationIssues: UsageReadResult["locationIssues"];
  /** Folders and files that the host could not read. Their stored sources stay. */
  unreadablePaths: string[];
};

/** Lists a folder for a walk. A folder that cannot be read has no entries in it. */
type ListFolder = (directory: string) => Dirent[];

/** Lists a folder. A missing folder has no entries; other failures throw. */
const entriesOf = (directory: string): Dirent[] => {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    if (isPathNotFoundError(cause)) return [];
    throw cause;
  }
};

/** The size and time of a file, or null when it does not exist. */
const statOf = (file: string) => {
  try {
    return statSync(file);
  } catch (cause) {
    if (isPathNotFoundError(cause)) return null;
    throw cause;
  }
};

const statSource = (
  runtime: RuntimeKind,
  file: string,
  format: UsageSourceFormat,
): DiskSource | null => {
  // The runtime removed the file during the walk.
  const stats = statOf(file);
  if (stats === null) return null;
  // A database writes to its write-ahead log first, so the log is part of its fingerprint.
  const log = format === "opencode" ? statOf(`${file}-wal`) : null;
  return {
    runtime,
    path: file,
    format,
    fingerprint: {
      size: stats.size + (log?.size ?? 0),
      modifiedAtMs: Math.max(stats.mtimeMs, log?.mtimeMs ?? 0),
      fileId: `${stats.dev}:${stats.ino}`,
    },
  };
};

/** `projects/<project>/<session>.jsonl` and `projects/<project>/<session>/subagents/*.jsonl`. */
const claudeFiles = (projects: string, entriesOf: ListFolder): string[] => {
  const files: string[] = [];
  for (const project of entriesOf(projects)) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(projects, project.name);
    for (const entry of entriesOf(projectPath)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path.join(projectPath, entry.name));
      } else if (entry.isDirectory()) {
        const subagents = path.join(projectPath, entry.name, "subagents");
        for (const agent of entriesOf(subagents)) {
          if (agent.isFile() && agent.name.endsWith(".jsonl"))
            files.push(path.join(subagents, agent.name));
        }
      }
    }
  }
  return files;
};

const CODEX_ROLLOUT = /^rollout-.*\.jsonl(\.zst)?$/;

const codexFiles = (directory: string, entriesOf: ListFolder): string[] => {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of entriesOf(folder)) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && CODEX_ROLLOUT.test(entry.name)) files.push(entryPath);
    }
  };
  walk(directory);
  const plain = new Set(files.filter((file) => file.endsWith(".jsonl")));
  // Codex reads the plain rollout when both forms exist.
  return files.filter((file) => !file.endsWith(".zst") || !plain.has(file.slice(0, -4)));
};

const openCodeFiles = (location: UsageLocations["opencode"], entriesOf: ListFolder): string[] => {
  if (location.databaseFile !== null) return [location.databaseFile];
  return entriesOf(location.directory)
    .filter((entry) => entry.isFile() && /^opencode.*\.db$/.test(entry.name))
    .map((entry) => path.join(location.directory, entry.name));
};

/**
 * Lists the native history sources of each runtime. A folder or file that cannot be read gives
 * an `unreadable` issue for its runtime, and the readable sources stay.
 */
export const discoverUsageSources = (
  locations: UsageLocations,
  runtimes: readonly RuntimeKind[],
): Discovery => {
  const discovery: Discovery = {
    sources: [],
    withoutHistory: [],
    locationIssues: [],
    unreadablePaths: [],
  };
  /** Keeps the readable sources of a runtime when some of its folders or files cannot be read. */
  const collect = (
    runtime: RuntimeKind,
    list: (entriesOf: ListFolder) => { file: string; format: UsageSourceFormat }[],
  ) => {
    if (!runtimes.includes(runtime)) return;
    const unreadable: string[] = [];
    const entries: ListFolder = (directory) => {
      try {
        return entriesOf(directory);
      } catch {
        unreadable.push(directory);
        return [];
      }
    };
    let found = 0;
    for (const { file, format } of list(entries)) {
      let source: DiskSource | null;
      try {
        source = statSource(runtime, file, format);
      } catch {
        unreadable.push(file);
        continue;
      }
      if (source === null) continue;
      discovery.sources.push(source);
      found++;
    }
    if (unreadable.length > 0) {
      discovery.locationIssues.push({ runtime, code: "unreadable" });
      discovery.unreadablePaths.push(...unreadable);
    } else if (found === 0) discovery.withoutHistory.push(runtime);
  };
  collect("claude", (entries) =>
    claudeFiles(locations.claude, entries).map((file) => ({ file, format: "jsonl" as const })),
  );
  collect("codex", (entries) =>
    locations.codex
      .flatMap((directory) => codexFiles(directory, entries))
      .map((file) => ({
        file,
        format: file.endsWith(".zst") ? ("jsonl_zst" as const) : ("jsonl" as const),
      })),
  );
  collect("opencode", (entries) =>
    openCodeFiles(locations.opencode, entries).map((file) => ({
      file,
      format: "opencode" as const,
    })),
  );
  return discovery;
};

/** True for a path inside, or equal to, one of the folders or files. */
export const isInsideAny = (file: string, folders: readonly string[]): boolean =>
  folders.some((folder) => pathStartsWith(file, folder));
