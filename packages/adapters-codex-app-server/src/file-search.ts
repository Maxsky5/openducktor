import type { CodexAppServerFuzzyFileSearchResult } from "@openducktor/contracts";
import { type AgentFileSearchResult, detectAgentFileReferenceKind } from "@openducktor/core";
import type { CodexAppServerClient } from "./types";

type CodexFileSearchInput = {
  query: string;
  workingDirectory: string;
};

const normalizeSeparators = (path: string): string => path.replace(/\\+/g, "/");

const isWindowsDrivePath = (path: string): boolean => /^[A-Za-z]:\//.test(path);

const normalizePathForComparison = (path: string): string => {
  return isWindowsDrivePath(path) ? path.toLowerCase() : path;
};

const isAbsolutePath = (path: string): boolean => {
  const normalized = normalizeSeparators(path.trim());
  return normalized.startsWith("/") || isWindowsDrivePath(normalized);
};

const trimTrailingSeparators = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/g, "");
  return trimmed.length > 0 ? trimmed : path;
};

const basename = (path: string): string => {
  const normalized = trimTrailingSeparators(normalizeSeparators(path));
  const parts = normalized.split("/").filter((segment) => segment.length > 0);
  return parts[parts.length - 1] ?? "";
};

const stripWorkingDirectoryPrefix = (path: string, workingDirectory: string): string => {
  const normalizedWorkingDirectory = trimTrailingSeparators(
    normalizeSeparators(workingDirectory.trim()),
  );
  if (normalizedWorkingDirectory.length === 0 || !isAbsolutePath(path)) {
    return path;
  }

  const workingDirectoryPrefix = normalizedWorkingDirectory.endsWith("/")
    ? normalizedWorkingDirectory
    : `${normalizedWorkingDirectory}/`;
  const comparablePath = normalizePathForComparison(path);
  const comparablePrefix = normalizePathForComparison(workingDirectoryPrefix);
  if (comparablePath.startsWith(comparablePrefix)) {
    return path.slice(workingDirectoryPrefix.length);
  }
  return path;
};

const normalizeReferencePath = (
  rawPath: string,
  workingDirectory: string,
  index: number,
): string => {
  const trimmedPath = rawPath.trim();
  if (trimmedPath.length === 0) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has an empty path.`);
  }
  const withoutTrailingSeparators = trimTrailingSeparators(normalizeSeparators(trimmedPath));
  const referencePath = stripWorkingDirectoryPrefix(withoutTrailingSeparators, workingDirectory);
  if (referencePath.trim().length === 0) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has an empty path.`);
  }
  return referencePath;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const requireStringField = (
  record: Record<string, unknown>,
  field: keyof CodexAppServerFuzzyFileSearchResult,
  index: number,
): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Codex fuzzyFileSearch result ${index} is missing string field '${field}'.`);
  }
  return value;
};

const requireNonEmptyStringField = (
  record: Record<string, unknown>,
  field: keyof CodexAppServerFuzzyFileSearchResult,
  index: number,
): string => {
  const value = requireStringField(record, field, index);
  if (value.trim().length === 0) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has an empty ${field}.`);
  }
  return value;
};

const requireFiniteNumberField = (
  record: Record<string, unknown>,
  field: keyof CodexAppServerFuzzyFileSearchResult,
  index: number,
): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has invalid ${field}.`);
  }
  return value;
};

const requireIndices = (value: unknown, index: number): number[] | null => {
  if (value === null) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has invalid indices.`);
  }
  return value;
};

const requireCodexFileSearchResult = (
  entry: unknown,
  index: number,
): CodexAppServerFuzzyFileSearchResult => {
  if (!isRecord(entry)) {
    throw new Error(`Codex fuzzyFileSearch result ${index} must be an object.`);
  }
  const root = requireNonEmptyStringField(entry, "root", index);
  const path = requireNonEmptyStringField(entry, "path", index);
  const matchType = requireStringField(entry, "match_type", index);
  if (matchType !== "file" && matchType !== "directory") {
    throw new Error(
      `Codex fuzzyFileSearch result ${index} has unsupported match_type '${matchType}'.`,
    );
  }
  return {
    root,
    path,
    match_type: matchType,
    file_name: requireStringField(entry, "file_name", index),
    score: requireFiniteNumberField(entry, "score", index),
    indices: requireIndices(entry.indices, index),
  };
};

const mapCodexFileSearchResult = (
  entry: CodexAppServerFuzzyFileSearchResult,
  workingDirectory: string,
  index: number,
): AgentFileSearchResult => {
  const path = normalizeReferencePath(entry.path, workingDirectory, index);
  const fallbackName = basename(path);
  const name = entry.file_name.trim().length > 0 ? entry.file_name : fallbackName || path;
  return {
    id: path,
    path,
    name,
    kind:
      entry.match_type === "directory"
        ? "directory"
        : detectAgentFileReferenceKind({ filePath: path }),
  };
};

export const toCodexFileSearchResults = (
  response: unknown,
  workingDirectory: string,
): AgentFileSearchResult[] => {
  if (!isRecord(response) || !Array.isArray(response.files)) {
    throw new Error("Codex fuzzyFileSearch response must include a files array.");
  }
  return response.files.map((entry, index) =>
    mapCodexFileSearchResult(requireCodexFileSearchResult(entry, index), workingDirectory, index),
  );
};

export const searchCodexFiles = async (
  client: CodexAppServerClient,
  input: CodexFileSearchInput,
): Promise<AgentFileSearchResult[]> => {
  const response = await client.fuzzyFileSearch({
    query: input.query,
    roots: [input.workingDirectory],
    cancellationToken: null,
  });
  return toCodexFileSearchResults(response, input.workingDirectory);
};
