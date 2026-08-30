import type {
  CodexAppServerFuzzyFileSearchResponse,
  CodexAppServerFuzzyFileSearchResult,
} from "@openducktor/contracts";
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

const requireNonEmptyStringField = (
  value: string,
  field: keyof CodexAppServerFuzzyFileSearchResult,
  index: number,
): string => {
  if (value.trim().length === 0) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has an empty ${field}.`);
  }
  return value;
};

const requireFiniteNumberField = (value: number, field: string, index: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has invalid ${field}.`);
  }
  return value;
};

const requireIndices = (
  value: CodexAppServerFuzzyFileSearchResult["indices"],
  index: number,
): number[] | null => {
  if (value === null) {
    return null;
  }
  if (value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`Codex fuzzyFileSearch result ${index} has invalid indices.`);
  }
  return value;
};

const requireMatchType = (
  value: CodexAppServerFuzzyFileSearchResult["match_type"],
  index: number,
): CodexAppServerFuzzyFileSearchResult["match_type"] => {
  if (value !== "file" && value !== "directory") {
    throw new Error(
      `Codex fuzzyFileSearch result ${index} has unsupported match_type '${String(value)}'.`,
    );
  }
  return value;
};

const requireCodexFileSearchResult = (
  entry: CodexAppServerFuzzyFileSearchResult,
  index: number,
): CodexAppServerFuzzyFileSearchResult => {
  return {
    root: requireNonEmptyStringField(entry.root, "root", index),
    path: requireNonEmptyStringField(entry.path, "path", index),
    match_type: requireMatchType(entry.match_type, index),
    file_name: entry.file_name,
    score: requireFiniteNumberField(entry.score, "score", index),
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

const toCodexFileSearchResults = (
  response: CodexAppServerFuzzyFileSearchResponse,
): AgentFileSearchResult[] =>
  response.files.map((entry, index) =>
    mapCodexFileSearchResult(requireCodexFileSearchResult(entry, index), index),
  );

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
