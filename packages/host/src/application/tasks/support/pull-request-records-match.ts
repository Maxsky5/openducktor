import { jsonValuesEqual, type PullRequest } from "@openducktor/contracts";
import { parseZonedIsoInstant } from "../../../domain/iso-instant";

const sameInstant = (left: string | undefined, right: string | undefined): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const leftInstant = parseZonedIsoInstant(left, "truncate");
  return leftInstant !== null && leftInstant === parseZonedIsoInstant(right, "truncate");
};

/**
 * Compares two pull request records without `lastSyncedAt`. Dates match as instants because the
 * task store reads them back in a different ISO format than providers send.
 */
export const pullRequestRecordsMatch = (left: PullRequest, right: PullRequest): boolean => {
  const {
    lastSyncedAt: _leftSync,
    createdAt: leftCreatedAt,
    updatedAt: leftUpdatedAt,
    mergedAt: leftMergedAt,
    closedAt: leftClosedAt,
    ...leftRecord
  } = left;
  const {
    lastSyncedAt: _rightSync,
    createdAt: rightCreatedAt,
    updatedAt: rightUpdatedAt,
    mergedAt: rightMergedAt,
    closedAt: rightClosedAt,
    ...rightRecord
  } = right;
  return (
    sameInstant(leftCreatedAt, rightCreatedAt) &&
    sameInstant(leftUpdatedAt, rightUpdatedAt) &&
    sameInstant(leftMergedAt, rightMergedAt) &&
    sameInstant(leftClosedAt, rightClosedAt) &&
    jsonValuesEqual(leftRecord, rightRecord)
  );
};
