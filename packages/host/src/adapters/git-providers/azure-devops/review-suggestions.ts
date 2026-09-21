import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostValidationError,
  errorMessage,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import {
  optionalRecord,
  optionalString,
  requireRecord,
  requireString,
  type ResolvedAzureDevOpsRepository,
} from "./models";
import type { AzureDevOpsRestClient } from "./rest-client";
import {
  azureDevOpsPositiveIntegerSchema,
  type AzureDevOpsJson,
  type AzureDevOpsJsonRecord,
} from "./json";

type SuggestionPosition = {
  line: number;
};

type AzureReviewCommentContentInput = {
  body: string;
  fileContent: string | null;
  fileWarning: string | null;
  rightStart: AzureDevOpsJsonRecord;
  rightEnd: AzureDevOpsJsonRecord;
};

export type AzureSuggestionFile = {
  content: string | null;
  warning: string | null;
};

type AzureReviewCommentContent = {
  body: string;
  suggestionPatches: string[];
  suggestionWarning: string | null;
};

const AZURE_SUGGESTION_BLOCK = /^```suggestion[^\r\n]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gmu;

export const hasAzureSuggestion = (body: string): boolean => {
  AZURE_SUGGESTION_BLOCK.lastIndex = 0;
  return AZURE_SUGGESTION_BLOCK.test(body);
};

const replacementLines = (replacement: string): string[] => {
  const normalized = replacement.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return normalized.length === 0 ? [] : normalized.split("\n");
};

const buildSuggestionPatch = (
  fileContent: string,
  start: SuggestionPosition,
  end: SuggestionPosition,
  replacement: string,
): string | null => {
  if (end.line < start.line) {
    return null;
  }
  const fileLines = fileContent.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const currentLines = fileLines.slice(start.line - 1, end.line);
  const expectedLineCount = end.line - start.line + 1;
  if (currentLines.length !== expectedLineCount) {
    return null;
  }
  const nextLines = replacementLines(replacement);
  return [
    `@@ -${start.line},${currentLines.length} +${start.line},${nextLines.length} @@`,
    ...currentLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ].join("\n");
};

export const parseAzureReviewCommentContent = ({
  body,
  fileContent,
  fileWarning,
  rightStart,
  rightEnd,
}: AzureReviewCommentContentInput): AzureReviewCommentContent => {
  const start = suggestionPosition(rightStart);
  const end = suggestionPosition(rightEnd);
  const replacements: string[] = [];
  AZURE_SUGGESTION_BLOCK.lastIndex = 0;
  const markdownBody = body
    .replace(AZURE_SUGGESTION_BLOCK, (_block, replacement: string) => {
      replacements.push(replacement.replace(/\r?\n$/u, ""));
      return "";
    })
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  if (replacements.length === 0) {
    return { body: markdownBody, suggestionPatches: [], suggestionWarning: null };
  }
  if (!fileContent || !start || !end) {
    return {
      body: body.trim(),
      suggestionPatches: [],
      suggestionWarning:
        fileWarning ?? "Azure DevOps suggestion lines could not be loaded from the source file.",
    };
  }

  const suggestionPatches = replacements.flatMap((replacement) => {
    const patch = buildSuggestionPatch(fileContent, start, end, replacement);
    return patch ? [patch] : [];
  });
  if (suggestionPatches.length !== replacements.length) {
    return {
      body: body.trim(),
      suggestionPatches: [],
      suggestionWarning: "Azure DevOps suggestion lines could not be located in the source file.",
    };
  }
  return { body: markdownBody, suggestionPatches, suggestionWarning: null };
};

export const readAzureSuggestionFiles = ({
  client,
  repoConfig,
  repository,
  sourceBranch,
  threads,
}: {
  client: AzureDevOpsRestClient;
  repoConfig: RepoConfig;
  repository: ResolvedAzureDevOpsRepository;
  sourceBranch: string;
  threads: AzureDevOpsJson[];
}) =>
  Effect.try({
    try: () => azureSuggestionPaths(threads),
    catch: asValidationError,
  }).pipe(
    Effect.flatMap((paths) =>
      Effect.forEach(
        paths,
        (path) =>
          client
            .request(repoConfig, repository, {
              operation: "read pull request suggestion file",
              path: `git/repositories/${encodeURIComponent(repository.repositoryId)}/items`,
              query: {
                $format: "json",
                path,
                includeContent: true,
                "versionDescriptor.version": sourceBranch,
                "versionDescriptor.versionType": "branch",
              },
            })
            .pipe(
              Effect.flatMap((response) =>
                Effect.try({
                  try: () => {
                    const content = requireString(
                      requireRecord(response.body, "suggestionFile").content,
                      "suggestionFile.content",
                    );
                    const suggestionFile: AzureSuggestionFile = { content, warning: null };
                    return [path, suggestionFile] as const;
                  },
                  catch: asValidationError,
                }),
              ),
              Effect.catchAll((cause) => {
                const suggestionFile: AzureSuggestionFile = {
                  content: null,
                  warning: `Azure DevOps suggestion source could not be loaded: ${errorMessage(cause)}`,
                };
                return Effect.succeed([path, suggestionFile] as const);
              }),
            ),
        { concurrency: 4 },
      ),
    ),
    Effect.map((entries) => new Map(entries)),
  );

const azureSuggestionPaths = (threads: AzureDevOpsJson[]): string[] => [
  ...new Set(
    threads.flatMap((value) => {
      const thread = requireRecord(value, "thread");
      const context = optionalRecord(thread.threadContext);
      const path = optionalString(context?.filePath);
      const comments = Array.isArray(thread.comments) ? thread.comments : [];
      return path &&
        comments.some((commentValue) => {
          const comment = requireRecord(commentValue, "thread.comment");
          const body = optionalString(comment.content);
          return comment.isDeleted !== true && body !== null && hasAzureSuggestion(body);
        })
        ? [path]
        : [];
    }),
  ),
];

const suggestionPosition = (value: AzureDevOpsJsonRecord): SuggestionPosition | null => {
  const line = azureDevOpsPositiveIntegerSchema.safeParse(value.line).data;
  if (line === undefined) {
    return null;
  }
  return { line };
};

const asValidationError = (cause: unknown): HostValidationErrorAggregate =>
  cause instanceof HostValidationError
    ? cause
    : new HostValidationError({ message: errorMessage(cause), cause });
