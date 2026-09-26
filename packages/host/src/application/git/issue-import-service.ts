import type {
  IssueItemsImportInput,
  IssueItemsImportResult,
  IssueItemsListInput,
  IssueItemGetInput,
  IssueImageGetInput,
  SourceIssue,
  TaskCard,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { IssueImportStorePort } from "../../ports/issue-import-store-port";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import type { GitProviderResolver } from "./git-provider-resolver";

const cursorSchema = z
  .object({ providerId: z.string(), scope: z.string(), search: z.string(), page: z.number().int() })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;

const readCursor = (
  value: string | undefined,
  providerId: string,
  scope: string,
  search: string,
): number => {
  if (!value) return 1;
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
      cursor.page <= (providerId === "github" ? 50 : 1_000)
    )
      return cursor.page;
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
        const { repoConfig, reader } = yield* resolve(input.repoPath);
        if (!reader.readImage) {
          return yield* new HostValidationError({
            field: "provider",
            message: "This Git provider does not support private Issue images.",
          });
        }
        return yield* reader.readImage({
          repoConfig,
          sourceId: input.sourceId,
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
        const page = yield* Effect.try({
          try: () => readCursor(input.cursor, reader.providerId, scope, search),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : new HostValidationError({ field: "cursor", message: String(cause) }),
        });
        const result = yield* reader.list({ repoConfig, search, page });
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
            ? nextCursor({ providerId: reader.providerId, scope, search, page: result.nextPage })
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
