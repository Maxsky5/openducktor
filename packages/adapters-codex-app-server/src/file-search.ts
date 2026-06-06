import type { CodexAppServerFuzzyFileSearchResult } from "@openducktor/contracts";
import { type AgentFileSearchResult, detectAgentFileReferenceKind } from "@openducktor/core";
import { basenameForPath, toProjectRelativePath } from "@openducktor/path-support";
import type { CodexAppServerClient } from "./types";

type CodexFileSearchInput = {
  query: string;
  workingDirectory: string;
};

const normalizeReferencePath = (rawPath: string, root: string, index: number): string => {
  const trimmedPath = rawPath.trim();
  if (trimmedPath.length === 0) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has an empty path.`);
  }
  return toProjectRelativePath(trimmedPath, root);
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
    throw new Error(`Codex fuzzyFileSearch result ${index} must include string field '${field}'.`);
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
  index: number,
): AgentFileSearchResult => {
  const path = normalizeReferencePath(entry.path, entry.root, index);
  const fallbackName = basenameForPath(path);
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

const toCodexFileSearchResults = (response: unknown): AgentFileSearchResult[] => {
  if (!isRecord(response) || !Array.isArray(response.files)) {
    throw new Error("Codex fuzzyFileSearch response must include a files array.");
  }
  return response.files.map((entry, index) =>
    mapCodexFileSearchResult(requireCodexFileSearchResult(entry, index), index),
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
  return toCodexFileSearchResults(response);
};
