import type { RepoStoreHealth } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  errorMessage,
  HostInvariantError,
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { SqliteDatabase } from "../../infrastructure/sqlite/sqlite-driver";
import type { TaskStoreError } from "../../ports/task-repository-ports";

export type TaskDocumentKind = "implementation_plan" | "qa_report" | "spec";

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  notes: string;
  status: string;
  issue_type: string;
  priority: number;
  parent_id: string | null;
  qa_required: number;
  labels_json: string;
  agent_sessions_json: string;
  target_branch_json: string | null;
  pull_request_json: string | null;
  direct_merge_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type TaskDocumentRow = {
  task_id: string;
  kind: TaskDocumentKind;
  revision: number;
  markdown: string;
  format: string;
  verdict: string | null;
  source_tool: string | null;
  updated_by: string | null;
  updated_at_ms: number | null;
};

const TASK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id text primary key,
  title text not null,
  description text not null,
  notes text not null,
  status text not null,
  issue_type text not null,
  priority integer not null,
  parent_id text null,
  qa_required integer not null,
  labels_json text not null,
  agent_sessions_json text not null,
  target_branch_json text null,
  pull_request_json text null,
  direct_merge_json text null,
  created_at_ms integer not null,
  updated_at_ms integer not null
);

CREATE TABLE IF NOT EXISTS task_documents (
  task_id text not null,
  kind text not null,
  revision integer not null,
  markdown text not null,
  format text not null,
  verdict text null,
  source_tool text null,
  updated_by text null,
  updated_at_ms integer null,
  primary key (task_id, kind, revision),
  foreign key (task_id) references tasks(id) on delete cascade
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at_ms);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_task_documents_latest ON task_documents(task_id, kind, revision);
`;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const hasRow = (value: unknown): boolean => value !== null && value !== undefined;

export const toTaskStoreError = (cause: unknown): TaskStoreError => {
  if (
    cause instanceof HostInvariantError ||
    cause instanceof HostOperationError ||
    cause instanceof HostResourceError ||
    cause instanceof HostValidationError
  ) {
    return cause;
  }

  return new HostOperationError({
    operation: "sqliteTaskRepository",
    message: errorMessage(cause),
    cause,
  });
};

export const mapTaskStoreErrors = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, TaskStoreError> => effect.pipe(Effect.mapError(toTaskStoreError));

export const executeSql = <A>(
  operation: string,
  databasePath: string,
  run: () => A,
): Effect.Effect<A, TaskStoreError> =>
  Effect.try({
    try: run,
    catch: (cause) =>
      new HostOperationError({
        operation,
        message: errorMessage(cause),
        cause,
        details: { databasePath },
      }),
  });

export const ensureSchema = (database: SqliteDatabase, databasePath: string) =>
  executeSql("sqliteTaskRepository.ensureSchema", databasePath, () => {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec(TASK_SCHEMA_SQL);
  });

export const repoStoreHealth = ({
  databasePath,
  detail,
  isReady,
  status,
}: {
  databasePath: string | null;
  detail: string | null;
  isReady: boolean;
  status: RepoStoreHealth["status"];
}): RepoStoreHealth => ({
  category: isReady ? "healthy" : "database_unavailable",
  status,
  isReady,
  detail,
  databasePath,
});

export const transaction = <A>(database: SqliteDatabase, run: () => A): A => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

export const requireString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new HostValidationError({ message: `${field} must be a string.`, field });
  }
  return value;
};

export const optionalString = (record: Record<string, unknown>, field: string): string | null => {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HostValidationError({ message: `${field} must be a string when present.`, field });
  }
  return value;
};

export const requireNumber = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (typeof value !== "number") {
    throw new HostValidationError({ message: `${field} must be a number.`, field });
  }
  return value;
};

export const optionalNumber = (record: Record<string, unknown>, field: string): number | null => {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number") {
    throw new HostValidationError({ message: `${field} must be a number when present.`, field });
  }
  return value;
};

export const requireDocumentKind = (value: unknown): TaskDocumentKind => {
  if (value === "implementation_plan" || value === "qa_report" || value === "spec") {
    return value;
  }
  throw new HostValidationError({
    message: `Unsupported SQLite task document kind: ${String(value)}`,
    field: "kind",
  });
};
