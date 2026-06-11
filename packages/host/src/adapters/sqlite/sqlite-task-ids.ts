import { createHash } from "node:crypto";
import { like, sql } from "drizzle-orm";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SqliteTaskStoreReadError } from "./sqlite-task-store-errors";
import { type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

export const TASK_ID_PREFIX_MAX_LENGTH = 10;

const MAX_HASH_LENGTH = 8;
const NONCE_ATTEMPTS_PER_LENGTH = 10;
const TASK_ID_CREATOR = "openducktor";
const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

type TaskIdCandidateInput = {
  readonly createdAt: Date;
  readonly description?: string | undefined;
  readonly prefix: string;
  readonly title: string;
};

export const taskIdPrefixForWorkspaceId = (workspaceId: string): string =>
  workspaceId.slice(0, TASK_ID_PREFIX_MAX_LENGTH).replace(/-+$/, "");

const base36FromBytes = (bytes: Uint8Array, length: number): string => {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 36n);
    encoded = `${BASE36_ALPHABET[remainder]}${encoded}`;
    value /= 36n;
  }

  const padded = encoded.padStart(length, "0");
  return padded.slice(-length);
};

const hashByteCountForLength = (length: number): number => {
  if (length === 4) {
    return 3;
  }
  if (length === 5 || length === 6) {
    return 4;
  }
  return 5;
};

const taskIdHashInput = ({
  createdAt,
  description,
  nonce,
  title,
}: Pick<TaskIdCandidateInput, "createdAt" | "description" | "title"> & {
  readonly nonce: number;
}): string => {
  return `${title}|${description ?? ""}|${TASK_ID_CREATOR}|${createdAt.getTime()}|${nonce}`;
};

export const generateTaskIdCandidate = ({
  createdAt,
  description,
  length,
  nonce,
  prefix,
  title,
}: Pick<TaskIdCandidateInput, "createdAt" | "description" | "title"> & {
  readonly length: number;
  readonly nonce: number;
  readonly prefix: string;
}): string => {
  const hash = createHash("sha256")
    .update(taskIdHashInput({ createdAt, description, nonce, title }))
    .digest();
  const suffix = base36FromBytes(hash.subarray(0, hashByteCountForLength(length)), length);
  return `${prefix}-${suffix}`;
};

const adaptiveHashLength = (taskCount: number): number => {
  if (taskCount < 100) {
    return 4;
  }
  if (taskCount < 1000) {
    return 5;
  }
  if (taskCount < 10000) {
    return 6;
  }
  return 7;
};

export const firstTaskIdHashLength = (
  session: TaskStoreSession,
  prefix: string,
): Effect.Effect<number, SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({ taskCount: sql<number>`count(*)` })
          .from(tasks)
          .where(like(tasks.id, `${prefix}-%`)),
      "sqliteTaskStore.nextTaskId.countTasksForPrefix",
      { prefix },
    );
    return adaptiveHashLength(rows[0]?.taskCount ?? 0);
  });

export function* taskIdCandidates(
  input: TaskIdCandidateInput & { readonly firstLength: number },
): Iterable<string> {
  const firstLength = Math.min(input.firstLength, MAX_HASH_LENGTH);
  for (let length = firstLength; length <= MAX_HASH_LENGTH; length += 1) {
    for (let nonce = 0; nonce < NONCE_ATTEMPTS_PER_LENGTH; nonce += 1) {
      yield generateTaskIdCandidate({ ...input, length, nonce });
    }
  }
}

export const taskIdExhaustedError = (prefix: string): HostOperationError =>
  new HostOperationError({
    operation: "sqliteTaskStore.nextTaskId",
    message: "Failed to generate a unique SQLite task id.",
    details: {
      maxHashLength: MAX_HASH_LENGTH,
      nonceAttemptsPerLength: NONCE_ATTEMPTS_PER_LENGTH,
      prefix,
    },
  });
