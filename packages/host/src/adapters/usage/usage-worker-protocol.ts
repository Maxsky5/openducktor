import type { MessagePort } from "node:worker_threads";
import type { RuntimeKind, UsageIndexProgress } from "@openducktor/contracts";
import type { UsageUnit } from "../../domain/usage/usage-unit";
import type { OpenCodeProgress } from "./usage-opencode-reader";
import type {
  UsageReadInput,
  UsageReadResult,
  UsageSourceIssue,
} from "../../ports/usage-index-port";

export type UsageIndexRequest =
  | { kind: "init"; indexPath: string; ratesUrl: string; parserPorts: MessagePort[] }
  | { kind: "read"; requestId: number; input: UsageReadInput }
  | { kind: "cancel"; requestId: number };

export type UsageIndexReply =
  | { kind: "result"; requestId: number; result: UsageReadResult }
  | { kind: "cancelled"; requestId: number }
  | { kind: "error"; requestId: number; message: string }
  | { kind: "progress"; requestId: number; progress: UsageIndexProgress }
  /** No read waits and no background work runs, so the threads can stop. */
  | { kind: "idle" };

export type UsageSourceFormat = "jsonl" | "jsonl_zst" | "opencode";

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
  jobId: number;
  runtime: RuntimeKind;
  path: string;
  format: UsageSourceFormat;
  fingerprint: UsageSourceFingerprint;
  previous: UsageStoredSource | null;
};

/**
 * A set of jobs for all parsers. `claims` holds two counters: the next job to claim, and 1 once
 * the run is canceled.
 */
export type UsageParseRun = {
  runId: number;
  jobs: readonly Omit<UsageParseJob, "jobId">[];
  claims: SharedArrayBuffer;
};

export type UsageParseReply =
  | { kind: "result"; runId: number; result: UsageParseResult }
  /** The progress inside one database source. */
  | { kind: "progress"; runId: number; jobId: number; progress: OpenCodeProgress }
  | { kind: "failed"; runId: number; message: string }
  | { kind: "idle"; runId: number };

export type UsageParseResult = {
  jobId: number;
  mode: "replace" | "append";
  units: UsageUnit[];
  resume: UsageResumePoint | null;
  parserState: string | null;
  issue: UsageSourceIssue | null;
};
