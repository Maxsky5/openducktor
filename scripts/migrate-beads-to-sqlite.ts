/// <reference types="bun" />

import { Database } from "bun:sqlite";
import { accessSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  agentSessionRecordSchema,
  directMergeRecordSchema,
  gitTargetBranchSchema,
  issueTypeSchema,
  pullRequestSchema,
  taskPrioritySchema,
  taskStatusSchema,
  WORKSPACE_ID_PATTERN,
} from "../packages/contracts/src/index";

const DOCUMENT_ENCODING_GZIP_BASE64_V1 = "gzip-base64-v1";
const DOCUMENT_FORMAT_PLAIN_TEXT = "plain_text";
const METADATA_NAMESPACE = "openducktor";
const SKIPPED_BEADS_INTERNAL_TYPES = new Set(["event", "gate"]);

type CliArgs = {
  configDir: string;
  dryRun: boolean;
  workspaceId: string;
};

type BeadsMetadata = {
  host: string;
  port: number;
  user: string;
};

type RawBdTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  issueType: string;
  labels: string[];
  parentId: string | null;
  metadata: unknown;
  updatedAtMs: number;
  createdAtMs: number;
};

type RawBdTaskDiscriminator = {
  issueType: string;
  record: Record<string, unknown>;
};

type MigratedTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  issueType: string;
  priority: number;
  parentId: string | null;
  qaRequired: boolean;
  labels: string[];
  agentSessions: unknown[];
  targetBranch: unknown | null;
  pullRequest: unknown | null;
  directMerge: unknown | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type MigratedDocument = {
  taskId: string;
  kind: "implementation_plan" | "qa_report" | "spec";
  revision: number;
  markdown: string;
  format: typeof DOCUMENT_FORMAT_PLAIN_TEXT;
  verdict: "approved" | "rejected" | null;
  sourceTool: string | null;
  updatedBy: string | null;
  updatedAtMs: number | null;
};

type ParsedSnapshot = {
  documents: MigratedDocument[];
  skippedInternalRecords: number;
  tasks: MigratedTask[];
};

const usage = (): never => {
  console.error(
    "Usage: bun run scripts/migrate-beads-to-sqlite.ts --config-dir <config-root> --workspace-id <workspaceId> [--dry-run]",
  );
  process.exit(1);
};

const parseArgs = (argv: string[]): CliArgs => {
  let configDir: string | null = null;
  let dryRun = false;
  let workspaceId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--config-dir" && value) {
      configDir = value;
      index += 1;
      continue;
    }
    if (arg === "--workspace-id" && value) {
      workspaceId = value;
      index += 1;
      continue;
    }
    usage();
  }
  if (!configDir || !workspaceId) {
    usage();
  }
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error(
      "workspaceId must already be a valid OpenDucktor workspace id. It is used literally in storage paths.",
    );
  }
  return {
    configDir: resolveUserPath(configDir),
    dryRun,
    workspaceId,
  };
};

const resolveUserPath = (input: string): string => {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(homedir(), input.slice(2));
  }
  return path.resolve(input);
};

const readJsonFile = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed reading JSON file ${filePath}: ${errorMessage(error)}`);
  }
};

const readBeadsMetadata = (filePath: string): BeadsMetadata => {
  const value = readJsonFile(filePath);
  if (!isRecord(value)) {
    throw new Error(`Beads metadata ${filePath} must be a JSON object.`);
  }
  const host = readRequiredString(value, "dolt_server_host", "beads metadata");
  const user = readRequiredString(value, "dolt_server_user", "beads metadata");
  const port = readRequiredInteger(value, "dolt_server_port", "beads metadata");
  if (port <= 0) {
    throw new Error(`beads metadata.dolt_server_port must be positive.`);
  }
  return { host, port, user };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRequiredString = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string.`);
  }
  return value;
};

const readOptionalString = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string | null => {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string when present.`);
  }
  return value;
};

const readRequiredInteger = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context}.${field} must be an integer.`);
  }
  return value;
};

const readOptionalBoolean = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): boolean | null => {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${context}.${field} must be a boolean when present.`);
  }
  return value;
};

const readOptionalNumber = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): number | null => {
  const value = record[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context}.${field} must be a number when present.`);
  }
  return value;
};

const readStringArray = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string[] => {
  const value = record[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${field} must be an array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${context}.${field}[${index}] must be a string.`);
    }
    return entry;
  });
};

const parseTimestampMs = (value: string, context: string): number => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${context} must be a parseable timestamp.`);
  }
  return ms;
};

const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

const decodeMarkdown = (entry: Record<string, unknown>, context: string): string => {
  const markdown = readRequiredString(entry, "markdown", context);
  const encoding = readOptionalString(entry, "encoding", context);
  if (encoding === null) {
    return markdown;
  }
  if (encoding !== DOCUMENT_ENCODING_GZIP_BASE64_V1) {
    throw new Error(`${context}.encoding is unsupported: ${encoding}.`);
  }
  try {
    return gunzipSync(Buffer.from(markdown, "base64")).toString("utf8");
  } catch (error) {
    throw new Error(`Failed decoding ${context}.markdown: ${errorMessage(error)}`);
  }
};

const documentRevision = (
  entry: Record<string, unknown>,
  fallbackRevision: number,
  context: string,
): number => {
  const revision = readOptionalNumber(entry, "revision", context);
  if (revision === null) {
    return fallbackRevision;
  }
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new Error(`${context}.revision must be a positive integer when present.`);
  }
  return revision;
};

const documentUpdatedAtMs = (entry: Record<string, unknown>, context: string): number | null => {
  const updatedAt = readOptionalString(entry, "updatedAt", context);
  return updatedAt === null ? null : parseTimestampMs(updatedAt, `${context}.updatedAt`);
};

const qaVerdict = (
  entry: Record<string, unknown>,
  context: string,
): "approved" | "rejected" | null => {
  const verdict = readOptionalString(entry, "verdict", context);
  if (verdict === null) {
    return null;
  }
  if (verdict === "approved" || verdict === "rejected") {
    return verdict;
  }
  throw new Error(`${context}.verdict must be approved or rejected when present.`);
};

const appendDocuments = (
  documents: MigratedDocument[],
  taskId: string,
  value: unknown,
  kind: MigratedDocument["kind"],
  metadataPath: string,
): void => {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${metadataPath} must be an array when present.`);
  }
  value.forEach((entry, index) => {
    const context = `${metadataPath}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${context} must be an object.`);
    }
    const verdict = kind === "qa_report" ? qaVerdict(entry, context) : null;
    documents.push({
      taskId,
      kind,
      revision: documentRevision(entry, index + 1, context),
      markdown: decodeMarkdown(entry, context),
      format: DOCUMENT_FORMAT_PLAIN_TEXT,
      verdict,
      sourceTool: readOptionalString(entry, "sourceTool", context),
      updatedBy: readOptionalString(entry, "updatedBy", context),
      updatedAtMs: documentUpdatedAtMs(entry, context),
    });
  });
};

const metadataNamespace = (metadata: unknown): Record<string, unknown> => {
  if (!isRecord(metadata)) {
    return {};
  }
  const namespace = metadata[METADATA_NAMESPACE];
  return isRecord(namespace) ? namespace : {};
};

const documentsNamespace = (namespace: Record<string, unknown>): Record<string, unknown> => {
  const documents = namespace.documents;
  return isRecord(documents) ? documents : {};
};

const parseTaskDiscriminator = (value: unknown): RawBdTaskDiscriminator => {
  if (!isRecord(value)) {
    throw new Error("bd list entry must be an object.");
  }
  const issueType = readRequiredString(value, "issue_type", "bd list entry");
  return { issueType, record: value };
};

const parseRawTask = ({ issueType, record }: RawBdTaskDiscriminator): RawBdTask => {
  const id = readRequiredString(record, "id", "task");
  return {
    id,
    title: readRequiredString(record, "title", `task ${id}`),
    description: readOptionalString(record, "description", `task ${id}`),
    status: readRequiredString(record, "status", `task ${id}`),
    priority: readRequiredInteger(record, "priority", `task ${id}`),
    issueType,
    labels: readStringArray(record, "labels", `task ${id}`),
    parentId: readOptionalString(record, "parent", `task ${id}`) ?? parentFromDependencies(record),
    metadata: record.metadata,
    updatedAtMs: parseTimestampMs(
      readRequiredString(record, "updated_at", `task ${id}`),
      `task ${id}.updated_at`,
    ),
    createdAtMs: parseTimestampMs(
      readRequiredString(record, "created_at", `task ${id}`),
      `task ${id}.created_at`,
    ),
  };
};

const parentFromDependencies = (record: Record<string, unknown>): string | null => {
  const dependencies = record.dependencies;
  if (dependencies === undefined) {
    return null;
  }
  if (!Array.isArray(dependencies)) {
    throw new Error("task.dependencies must be an array when present.");
  }
  for (const [index, dependency] of dependencies.entries()) {
    if (!isRecord(dependency)) {
      throw new Error(`task.dependencies[${index}] must be an object.`);
    }
    const dependencyType =
      readOptionalString(dependency, "type", `task.dependencies[${index}]`) ??
      readOptionalString(dependency, "dependency_type", `task.dependencies[${index}]`);
    if (dependencyType !== "parent-child") {
      continue;
    }
    return (
      readOptionalString(dependency, "depends_on_id", `task.dependencies[${index}]`) ??
      readOptionalString(dependency, "id", `task.dependencies[${index}]`)
    );
  }
  return null;
};

const parseTask = (raw: RawBdTask): MigratedTask => {
  const issueType = issueTypeSchema.parse(raw.issueType);
  const namespace = metadataNamespace(raw.metadata);
  const delivery = isRecord(namespace.delivery) ? namespace.delivery : {};
  const targetBranch =
    namespace.targetBranch === undefined
      ? null
      : gitTargetBranchSchema.parse(namespace.targetBranch);
  const pullRequestCandidate =
    namespace.pullRequest ?? (delivery.linkedPullRequest ? delivery.linkedPullRequest : undefined);
  const directMergeCandidate =
    namespace.directMerge ?? (delivery.directMerge ? delivery.directMerge : undefined);
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: taskStatusSchema.parse(raw.status),
    issueType,
    priority: taskPrioritySchema.parse(raw.priority),
    parentId: raw.parentId,
    qaRequired:
      readOptionalBoolean(namespace, "qaRequired", `task ${raw.id}.metadata.openducktor`) ?? true,
    labels: normalizeLabels(raw.labels),
    agentSessions:
      namespace.agentSessions === undefined
        ? []
        : agentSessionRecordSchema.array().parse(namespace.agentSessions),
    targetBranch,
    pullRequest:
      pullRequestCandidate === undefined ? null : pullRequestSchema.parse(pullRequestCandidate),
    directMerge:
      directMergeCandidate === undefined
        ? null
        : directMergeRecordSchema.parse(directMergeCandidate),
    createdAtMs: raw.createdAtMs,
    updatedAtMs: raw.updatedAtMs,
  };
};

const parseSnapshot = (payload: unknown): ParsedSnapshot => {
  if (!Array.isArray(payload)) {
    throw new Error("bd list --json must return an array.");
  }
  const tasks: MigratedTask[] = [];
  const documents: MigratedDocument[] = [];
  let skippedInternalRecords = 0;
  for (const entry of payload) {
    const discriminator = parseTaskDiscriminator(entry);
    if (SKIPPED_BEADS_INTERNAL_TYPES.has(discriminator.issueType)) {
      skippedInternalRecords += 1;
      continue;
    }
    const raw = parseRawTask(discriminator);
    const task = parseTask(raw);
    tasks.push(task);
    const documentsMetadata = documentsNamespace(metadataNamespace(raw.metadata));
    appendDocuments(
      documents,
      task.id,
      documentsMetadata.spec,
      "spec",
      `${METADATA_NAMESPACE}.documents.spec`,
    );
    appendDocuments(
      documents,
      task.id,
      documentsMetadata.implementationPlan,
      "implementation_plan",
      `${METADATA_NAMESPACE}.documents.implementationPlan`,
    );
    appendDocuments(
      documents,
      task.id,
      documentsMetadata.qaReports,
      "qa_report",
      `${METADATA_NAMESPACE}.documents.qaReports`,
    );
  }
  return { documents, skippedInternalRecords, tasks };
};

const taskStoreDatabasePath = (configDir: string, workspaceId: string): string =>
  path.join(configDir, "task-stores", workspaceId, "database.sqlite");

const beadsAttachmentRoot = (configDir: string, workspaceId: string): string =>
  path.join(configDir, "beads", workspaceId);

const beadsAttachmentPath = (configDir: string, workspaceId: string): string =>
  path.join(beadsAttachmentRoot(configDir, workspaceId), ".beads");

const beadsMetadataPath = (beadsDir: string): string => path.join(beadsDir, "metadata.json");

const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

const runBdJson = ({
  args,
  beadsDir,
  cwd,
  metadata,
}: {
  args: string[];
  beadsDir: string;
  cwd: string;
  metadata: BeadsMetadata;
}): unknown => {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(["bd", ...args, "--json"], {
      cwd,
      env: {
        ...process.env,
        BEADS_DIR: beadsDir,
        BEADS_DOLT_SERVER_MODE: "1",
        BEADS_DOLT_SERVER_HOST: metadata.host,
        BEADS_DOLT_SERVER_PORT: String(metadata.port),
        BEADS_DOLT_SERVER_USER: metadata.user,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
  } catch (error) {
    throw new Error(`Failed to run bd from PATH: ${errorMessage(error)}`);
  }

  const stdout = decode(result.stdout);
  const stderr = decode(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(
      `bd ${args[0] ?? "command"} failed with exit code ${result.exitCode}: ${
        stderr.trim() || stdout.trim() || "no output"
      }`,
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Failed to parse bd ${args[0] ?? "command"} JSON output: ${errorMessage(error)}`,
    );
  }
};

const confirmBeadsAttachment = (payload: unknown, expectedBeadsDir: string): void => {
  if (!isRecord(payload)) {
    throw new Error("bd where --json must return an object.");
  }
  const error = readOptionalString(payload, "error", "bd where");
  if (error) {
    throw new Error(`bd where failed: ${error}`);
  }
  const actualPath = readRequiredString(payload, "path", "bd where");
  if (actualPath !== expectedBeadsDir) {
    throw new Error(`bd where resolved ${actualPath}; expected ${expectedBeadsDir}.`);
  }
};

const assertTargetDatabaseExists = (databasePath: string): void => {
  try {
    accessSync(databasePath);
  } catch {
    throw new Error(
      `Target SQLite database does not exist: ${databasePath}. Start OpenDucktor once for this workspace so the native SQLite Task Store creates the database and schema, then rerun the migration.`,
    );
  }
};

const insertSnapshot = (databasePath: string, snapshot: ParsedSnapshot): void => {
  const database = new Database(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec("BEGIN IMMEDIATE;");
    try {
      const insertTask = database.prepare(
        `insert into tasks (
          id, title, description, status, issue_type, priority, parent_id, qa_required,
          labels_json, agent_sessions_json, target_branch_json, pull_request_json,
          direct_merge_json, created_at_ms, updated_at_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const task of snapshot.tasks) {
        insertTask.run(
          task.id,
          task.title,
          task.description,
          task.status,
          task.issueType,
          task.priority,
          task.parentId,
          task.qaRequired ? 1 : 0,
          JSON.stringify(task.labels),
          JSON.stringify(task.agentSessions),
          task.targetBranch === null ? null : JSON.stringify(task.targetBranch),
          task.pullRequest === null ? null : JSON.stringify(task.pullRequest),
          task.directMerge === null ? null : JSON.stringify(task.directMerge),
          task.createdAtMs,
          task.updatedAtMs,
        );
      }
      const insertDocument = database.prepare(
        `insert into task_documents (
          task_id, kind, revision, markdown, format, verdict, source_tool, updated_by, updated_at_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const document of snapshot.documents) {
        insertDocument.run(
          document.taskId,
          document.kind,
          document.revision,
          document.markdown,
          document.format,
          document.verdict,
          document.sourceTool,
          document.updatedBy,
          document.updatedAtMs,
        );
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    database.close();
  }
};

const countBy = <T>(items: readonly T[], key: (item: T) => string): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const countKey = key(item);
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
};

const formatCounts = (counts: Array<[string, number]>): string =>
  counts.length === 0 ? "none" : counts.map(([key, count]) => `${key}: ${count}`).join(", ");

const printSnapshotReport = ({
  dryRun,
  snapshot,
  targetDatabasePath,
}: {
  dryRun: boolean;
  snapshot: ParsedSnapshot;
  targetDatabasePath: string;
}): void => {
  console.log(
    dryRun
      ? "SQLite task store migration dry run complete."
      : "SQLite task store migration complete.",
  );
  console.log(`Target database: ${targetDatabasePath}`);
  console.log(dryRun ? "SQLite writes: skipped (--dry-run)" : "SQLite writes: committed");
  console.log(`${dryRun ? "Tasks to insert" : "Tasks inserted"}: ${snapshot.tasks.length}`);
  console.log(
    `${dryRun ? "Task documents to insert" : "Task documents inserted"}: ${
      snapshot.documents.length
    }`,
  );
  console.log(`Task statuses: ${formatCounts(countBy(snapshot.tasks, (task) => task.status))}`);
  console.log(
    `Task issue types: ${formatCounts(countBy(snapshot.tasks, (task) => task.issueType))}`,
  );
  console.log(
    `Task document kinds: ${formatCounts(countBy(snapshot.documents, (document) => document.kind))}`,
  );
  console.log(`Skipped Beads-internal records: ${snapshot.skippedInternalRecords}`);
};

const main = (): void => {
  const { configDir, dryRun, workspaceId } = parseArgs(process.argv.slice(2));
  const targetDatabasePath = taskStoreDatabasePath(configDir, workspaceId);
  const beadsDir = beadsAttachmentPath(configDir, workspaceId);
  const attachmentRoot = beadsAttachmentRoot(configDir, workspaceId);
  const metadata = readBeadsMetadata(beadsMetadataPath(beadsDir));
  if (!dryRun) {
    assertTargetDatabaseExists(targetDatabasePath);
  }
  confirmBeadsAttachment(
    runBdJson({
      args: ["where"],
      beadsDir,
      cwd: attachmentRoot,
      metadata,
    }),
    beadsDir,
  );
  const snapshot = parseSnapshot(
    runBdJson({
      args: ["list", "--all", "--limit", "0"],
      beadsDir,
      cwd: attachmentRoot,
      metadata,
    }),
  );
  if (!dryRun) {
    insertSnapshot(targetDatabasePath, snapshot);
  }
  printSnapshotReport({ dryRun, snapshot, targetDatabasePath });
};

try {
  main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
