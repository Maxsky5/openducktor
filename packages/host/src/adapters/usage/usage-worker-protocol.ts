import type { MessagePort } from "node:worker_threads";
import type { RuntimeKind, UsageIndexProgress } from "@openducktor/contracts";
import type { UsageIndexFigures, UsageSourceIssue } from "../../domain/usage/usage-report";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import type { UsageReadInput } from "../../ports/usage-index-port";
import type { UsageLocations } from "./usage-locations";

/** A read as the index worker gets it: the read of the port and the history folders. */
export type UsageIndexReadInput = UsageReadInput & { locations: UsageLocations };

export type UsageIndexRequest =
  | { kind: "init"; indexPath: string; ratesUrl: string; parserPorts: MessagePort[] }
  | { kind: "read"; requestId: number; input: UsageIndexReadInput }
  | { kind: "cancel"; requestId: number };

export type UsageIndexReply =
  | { kind: "result"; requestId: number; result: UsageIndexFigures }
  | { kind: "cancelled"; requestId: number }
  | { kind: "error"; requestId: number; message: string }
  | { kind: "progress"; requestId: number; progress: UsageIndexProgress }
  /** No read waits and no background work runs, so the threads can stop. */
  | { kind: "idle" };

/** A JSON lines file, a compressed one, the OpenCode database, or an Antigravity conversation. */
export type UsageSourceFormat = "jsonl" | "jsonl_zst" | "opencode" | "antigravity";

/** The size, time, and device and inode of a source. A change means a new read. */
export type UsageSourceFingerprint = { size: number; modifiedAtMs: number; fileId: string };

/** The end of the last complete line, and a digest of the bytes before it. */
export type UsageResumePoint = { offset: number; digest: string };

/** What the index kept of a source after its last read. */
export type UsageStoredSource = {
  fingerprint: UsageSourceFingerprint;
  resume: UsageResumePoint | null;
  parserState: string | null;
  /** The last read failed, so the next check reads it again whatever its fingerprint. */
  unreadable: boolean;
};

/** One source to parse. The parser decides from `previous` where its read starts. */
export type UsageParseJob = {
  runtime: RuntimeKind;
  path: string;
  format: UsageSourceFormat;
  fingerprint: UsageSourceFingerprint;
  previous: UsageStoredSource | null;
};

/**
 * The progress inside a database source: the share of the scanned row IDs, and the root sessions
 * whose rows the scan passed. A read that continues from a cursor does not know its sessions, so
 * their total is null.
 */
export type OpenCodeProgress = {
  fraction: number;
  sessions: { done: number; total: number | null };
};

/**
 * A set of jobs for all parsers. `claims` holds two counters: the next job to claim, and 1 once
 * the run is canceled.
 */
export type UsageParseRun = {
  runId: number;
  jobs: readonly UsageParseJob[];
  claims: SharedArrayBuffer;
};

/** Replies of a parser. `jobId` is the index of the job in the jobs of the run. */
export type UsageParseReply =
  | { kind: "result"; runId: number; jobId: number; result: UsageParseResult }
  /** The progress inside one database source. */
  | { kind: "progress"; runId: number; jobId: number; progress: OpenCodeProgress }
  | { kind: "failed"; runId: number; message: string }
  | { kind: "idle"; runId: number };

export type UsageParseResult = {
  mode: "replace" | "append";
  units: UsageUnit[];
  resume: UsageResumePoint | null;
  parserState: string | null;
  issue: UsageSourceIssue | null;
};
