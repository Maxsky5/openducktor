import type {
  IssueItemsImportInput,
  IssueItemsImportResult,
  IssueItemsListInput,
  IssueItemGetInput,
  IssueImageGetInput,
  RepoConfig,
  SourceIssueReference,
  SourceIssue,
  TaskCard,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";
import type { IssueReaderPort } from "../../ports/git-provider-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { GitProviderResolver } from "./git-provider-resolver";

const cursorSchema = z
  .object({
    providerId: z.string(),
    scope: z.string(),
    search: z.string(),
    page: z.number().int(),
    snapshot: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;

const readCursor = (
  value: string | undefined,
  providerId: string,
  scope: string,
  search: string,
): Pick<Cursor, "page" | "snapshot"> => {
  if (!value) return { page: 1 };
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    const cursor = parsed.success ? parsed.data : null;
    if (
      cursor?.providerId === providerId &&
      cursor.scope === scope &&
      cursor.search === search &&
      Number.isSafeInteger(cursor.page) &&
      cursor.page > 1 &&
      cursor.page <= (providerId === "github" ? 50 : 1_000) &&
      (providerId !== "azure_devops" || Boolean(cursor.snapshot))
    )
      return { page: cursor.page, snapshot: cursor.snapshot };
  } catch {
    /* Invalid cursors have the same user action. */
  }
  throw new HostValidationError({
    field: "cursor",
    message:
      "This Issue page is no longer valid for the current repository or search. Start from the first page.",
  });
};

const nextCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");

const githubImageRepoConfig = (
  repoConfig: RepoConfig,
  source: SourceIssueReference,
): Effect.Effect<RepoConfig, HostValidationError> => {
  const issueUrl = URL.canParse(source.url) ? new URL(source.url) : null;
  const parts = issueUrl?.pathname.split("/").filter(Boolean);
  const owner = parts?.[0];
  const name = parts?.[1];
  if (
    source.providerId !== "github" ||
    issueUrl?.protocol !== "https:" ||
    issueUrl.search !== "" ||
    issueUrl.hash !== "" ||
    !owner ||
    !name ||
    parts?.length !== 4 ||
    parts[2] !== "issues" ||
    parts[3] !== source.sourceId ||
    `${issueUrl.host}/${owner}/${name}`.toLowerCase() !== source.scope.toLowerCase()
  ) {
    return Effect.fail(
      new HostValidationError({
        field: "taskId",
        message: "This Task has no valid GitHub Issue source for its images.",
      }),
    );
  }
  return Effect.succeed({
    ...repoConfig,
    git: {
      ...repoConfig.git,
      provider: {
        id: "github",
        enabled: true,
        autoDetected: false,
        repository: { host: issueUrl.host, owner, name },
      },
    },
  });
};

export const createIssueImportService = ({
  resolver,
  store,
  workspaceSettingsService,
  publishTaskCreated,
}: {
  resolver: GitProviderResolver;
  store: IssueImportStorePort;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
  publishTaskCreated: (repoPath: string, task: TaskCard) => Effect.Effect<void>;
}) => {
  const resolve = (repoPath: string) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const provider = yield* resolver.resolve(repoConfig);
      const reader = yield* provider.issues();
      const scope = yield* reader.scope(repoConfig);
      return {
        repoConfig,
        reader,
        scope,
        searchSupported: provider.getDescriptor().capabilities.issueAccess === "search",
      };
    });

  return {
    getImage(input: IssueImageGetInput) {
      return Effect.gen(function* () {
        let repoConfig: RepoConfig;
        let sourceId: string;
        let reader: IssueReaderPort;
        if ("taskId" in input) {
          const currentConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(
            input.repoPath,
          );
          const source = yield* store.getSourceIssue({
            repoPath: input.repoPath,
            taskId: input.taskId,
          });
          if (!source) {
            return yield* new HostValidationError({
              field: "taskId",
              message: "This Task has no source Issue. Refresh the Task and try again.",
            });
          }
          repoConfig = yield* githubImageRepoConfig(currentConfig, source);
          sourceId = source.sourceId;
          const provider = yield* resolver.resolve(repoConfig);
          reader = yield* provider.issues();
        } else {
          const resolved = yield* resolve(input.repoPath);
          repoConfig = resolved.repoConfig;
          reader = resolved.reader;
          sourceId = input.sourceId;
        }
        if (!reader.readImage) {
          return yield* new HostValidationError({
            field: "provider",
            message: "This Git provider does not support private Issue images.",
          });
        }
        return yield* reader.readImage({
          repoConfig,
          sourceId,
          url: input.url,
        });
      });
    },
    get(input: IssueItemGetInput) {
      return Effect.gen(function* () {
        const { repoConfig, reader, scope } = yield* resolve(input.repoPath);
        const item = yield* reader.get({ repoConfig, sourceId: input.sourceId });
        if (
          item.sourceId !== input.sourceId ||
          item.scope !== scope ||
          item.providerId !== reader.providerId
        ) {
          return yield* new HostValidationError({
            field: "sourceId",
            message: "The source item is outside the configured repository. Refresh the list.",
          });
        }
        const linked = yield* store.findLinkedTaskIds({
          repoPath: input.repoPath,
          providerId: reader.providerId,
          scope,
          sourceIds: [input.sourceId],
        });
        return linked[input.sourceId] ? { ...item, linkedTaskId: linked[input.sourceId] } : item;
      });
    },
    list(input: IssueItemsListInput) {
      return Effect.gen(function* () {
        const { repoConfig, reader, scope, searchSupported } = yield* resolve(input.repoPath);
        const search = input.search.trim();
        if (search && !searchSupported) {
          return yield* new HostValidationError({
            field: "search",
            message: "This Git provider does not support Issue search. Clear the search and retry.",
          });
        }
        const cursor = yield* Effect.try({
          try: () => readCursor(input.cursor, reader.providerId, scope, search),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : new HostValidationError({ field: "cursor", message: String(cause) }),
        });
        const readerInput: Parameters<IssueReaderPort["list"]>[0] = {
          repoConfig,
          search,
          page: cursor.page,
        };
        if (cursor.snapshot) readerInput.snapshot = cursor.snapshot;
        const result = yield* reader.list(readerInput);
        if (
          result.items.some((item) => item.scope !== scope || item.providerId !== reader.providerId)
        ) {
          return yield* new HostValidationError({
            field: "provider",
            message:
              "The provider returned an Issue outside this repository. Check the provider settings and retry.",
          });
        }
        const linked = yield* store.findLinkedTaskIds({
          repoPath: input.repoPath,
          providerId: reader.providerId,
          scope,
          sourceIds: result.items.map((item) => item.sourceId),
        });
        const items: SourceIssue[] = result.items.map((item) =>
          linked[item.sourceId] ? { ...item, linkedTaskId: linked[item.sourceId] } : item,
        );
        return {
          items,
          nextCursor: result.nextPage
            ? nextCursor({
                providerId: reader.providerId,
                scope,
                search,
                page: result.nextPage,
                snapshot: result.snapshot,
              })
            : undefined,
          searchSupported,
          incompleteResults: result.incompleteResults ?? false,
        };
      });
    },
    import(input: IssueItemsImportInput) {
      return Effect.gen(function* () {
        const { repoConfig, reader, scope } = yield* resolve(input.repoPath);
        const preparedGet = yield* Effect.either(reader.prepareGet(repoConfig));
        const seen = new Set<string>();
        const results: IssueItemsImportResult["results"] = [];
        for (const review of input.items) {
          if (seen.has(review.sourceId)) {
            results.push({
              sourceId: review.sourceId,
              outcome: "failed",
              reason: "This source item appears twice in the import request.",
            });
            continue;
          }
          seen.add(review.sourceId);
          if (preparedGet._tag === "Left") {
            results.push({
              sourceId: review.sourceId,
              outcome: "failed",
              reason: errorMessage(preparedGet.left),
            });
            continue;
          }
          const outcome = yield* Effect.either(
            Effect.gen(function* () {
              const source = yield* preparedGet.right(review.sourceId);
              if (
                source.sourceId !== review.sourceId ||
                source.providerId !== reader.providerId ||
                source.scope !== scope
              ) {
                return yield* new HostValidationError({
                  field: "sourceId",
                  message:
                    "The source item is outside the configured repository. Refresh the list.",
                });
              }
              if (source.revision !== review.revision) {
                return yield* new HostValidationError({
                  field: "revision",
                  message:
                    "The source item changed since review. Refresh it and review the new content.",
                });
              }
              const created = yield* store.createImportedTask({
                repoPath: input.repoPath,
                sourceIssue: source,
                task: {
                  title: source.title,
                  description: source.description,
                  issueType: review.issueType,
                  priority: review.priority,
                  labels: review.labels,
                  aiReviewEnabled: true,
                },
              });
              if (created.outcome === "duplicate") {
                return {
                  outcome: "failed" as const,
                  taskId: created.taskId,
                  reason: `This source item is already linked to Task ${created.taskId}.`,
                };
              }
              yield* publishTaskCreated(input.repoPath, created.task);
              return { outcome: "created" as const, taskId: created.task.id };
            }),
          );
          if (outcome._tag === "Right") {
            results.push({ sourceId: review.sourceId, ...outcome.right });
          } else {
            results.push({
              sourceId: review.sourceId,
              outcome: "failed",
              reason: errorMessage(outcome.left),
            });
          }
        }
        return { results };
      });
    },
  };
};
