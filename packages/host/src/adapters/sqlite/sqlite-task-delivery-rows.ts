import type { DirectMergeRecord, PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { parseZonedIsoInstant } from "../../domain/iso-instant";
import { HostValidationError } from "../../effect/host-errors";
import type { taskDirectMerges, taskPullRequests } from "./sqlite-host-database-schema";

type PullRequestRow = typeof taskPullRequests.$inferSelect;
type DirectMergeRow = typeof taskDirectMerges.$inferSelect;

/** Delivery dates come from Git providers. Precision below one millisecond has no use here. */
const deliveryInstant = (
  value: string,
  field: string,
): Effect.Effect<number, HostValidationError> => {
  const milliseconds = parseZonedIsoInstant(value, "truncate");
  return milliseconds === null
    ? Effect.fail(
        new HostValidationError({
          field,
          message: `${field} must be a zoned ISO 8601 date, but it is ${JSON.stringify(value)}. Correct the date and retry.`,
        }),
      )
    : Effect.succeed(milliseconds);
};

const optionalInstant = (value: string | undefined, field: string) =>
  value === undefined ? Effect.succeed(null) : deliveryInstant(value, field);

const isoText = (milliseconds: number): string => new Date(milliseconds).toISOString();

const optionalIso = (milliseconds: number | null): string | undefined =>
  milliseconds === null ? undefined : isoText(milliseconds);

export const pullRequestRowValues = (pullRequest: PullRequest) =>
  Effect.all({
    createdAt: deliveryInstant(pullRequest.createdAt, "pullRequest.createdAt"),
    updatedAt: deliveryInstant(pullRequest.updatedAt, "pullRequest.updatedAt"),
    lastSyncedAt: optionalInstant(pullRequest.lastSyncedAt, "pullRequest.lastSyncedAt"),
    mergedAt: optionalInstant(pullRequest.mergedAt, "pullRequest.mergedAt"),
    closedAt: optionalInstant(pullRequest.closedAt, "pullRequest.closedAt"),
  }).pipe(
    Effect.map((dates) => ({
      ...pullRequest,
      repositoryIdentity: pullRequest.repositoryIdentity ?? null,
      ...dates,
    })),
  );

/** Returns the public shape. Callers validate it with the contracts schema. */
export const pullRequestFromRow = (row: PullRequestRow) => ({
  providerId: row.providerId,
  repositoryIdentity: row.repositoryIdentity ?? undefined,
  number: row.number,
  url: row.url,
  state: row.state,
  createdAt: isoText(row.createdAt),
  updatedAt: isoText(row.updatedAt),
  lastSyncedAt: optionalIso(row.lastSyncedAt),
  mergedAt: optionalIso(row.mergedAt),
  closedAt: optionalIso(row.closedAt),
});

export const directMergeRowValues = (directMerge: DirectMergeRecord) =>
  deliveryInstant(directMerge.mergedAt, "directMerge.mergedAt").pipe(
    Effect.map((mergedAt) => ({
      method: directMerge.method,
      sourceBranch: directMerge.sourceBranch,
      targetBranch: directMerge.targetBranch.branch,
      targetRemote: directMerge.targetBranch.remote ?? null,
      mergedAt,
    })),
  );

export const directMergeFromRow = (row: DirectMergeRow) => ({
  method: row.method,
  sourceBranch: row.sourceBranch,
  targetBranch:
    row.targetRemote === null
      ? { branch: row.targetBranch }
      : { branch: row.targetBranch, remote: row.targetRemote },
  mergedAt: isoText(row.mergedAt),
});
