import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { AgentRuntimeQueryError, type LoadAgentSessionHistoryInput } from "@openducktor/core";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import {
  claudeSubagentAgentId,
  parseClaudeTranscriptTarget,
} from "./claude-agent-sdk-subagent-transcripts";
import {
  CLAUDE_TRANSCRIPT_MISSING_MESSAGE,
  readClaudeTranscriptFingerprint,
  scanClaudeTranscript,
  scanClaudeTranscriptBatches,
} from "./claude-transcript-file";
import {
  readClaudeTranscriptOrderMetadata,
  selectClaudeTranscriptEntries,
  type ClaudeTranscriptOrderMetadata,
} from "./claude-transcript-order";
import { createClaudeTranscriptQueuedCommands } from "./claude-transcript-queued-commands";
import {
  createDiskClaudeTranscriptStorage,
  createMemoryClaudeTranscriptStorage,
  type ClaudeTranscriptStorage,
} from "./claude-transcript-storage";

export { CLAUDE_TRANSCRIPT_MISSING_MESSAGE } from "./claude-transcript-file";

export type ClaudeTranscriptReadOptions = {
  processEnv?: NodeJS.ProcessEnv;
  storage?: "memory" | "disk";
  reader?: ClaudeTranscriptReader;
};

type RecordValue = ClaudeProtocolObject;
export type ClaudeTranscriptReadFailure = HostOperationError | AgentRuntimeQueryError;
type ReadFailure = ClaudeTranscriptReadFailure;

const isReadFailure = (cause: unknown): cause is ReadFailure =>
  cause instanceof AgentRuntimeQueryError ||
  (cause instanceof HostOperationError && cause.details === undefined);

export type ClaudeTranscriptReadResult = {
  readonly messages: readonly RecordValue[];
  readonly source: ClaudeTranscriptSource;
};

export type ClaudeTranscriptReader = {
  read(
    input: LoadAgentSessionHistoryInput,
  ): Effect.Effect<ClaudeTranscriptReadResult, ClaudeTranscriptReadFailure>;
};

const missingTranscript = (): AgentRuntimeQueryError =>
  new AgentRuntimeQueryError("request_failed", CLAUDE_TRANSCRIPT_MISSING_MESSAGE);

const fileErrorSchema = z.object({ code: z.string() });
const scopeMetadataSchema = z.object({
  type: z.string().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  relocatedCwd: z.string().optional(),
});
const isMissingFile = (cause: unknown): boolean => {
  const parsed = fileErrorSchema.safeParse(cause);
  return parsed.success && parsed.data.code === "ENOENT";
};

const sourceError = (operation: string, path: string, cause: unknown): HostOperationError =>
  new HostOperationError({
    operation: `claude.transcript.${operation}`,
    message: `Cannot ${operation} Claude transcript '${path}': ${errorMessage(cause)}`,
    cause,
  });

const findTranscripts = async (
  directory: string,
  filename: string,
  recursive: boolean,
): Promise<string[]> => {
  const matches: string[] = [];
  const visit = async (path: string): Promise<void> => {
    if (!(await lstat(path)).isDirectory())
      throw new Error("The transcript directory must be a regular directory, not a symbolic link.");
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === filename) matches.push(join(path, entry.name));
      else if (recursive && entry.isDirectory()) await visit(join(path, entry.name));
    }
  };
  if (recursive) await visit(directory);
  else {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(join(directory, entry.name));
    }
  }
  return matches;
};

const resolveTranscriptPaths = (
  input: LoadAgentSessionHistoryInput,
  options: ClaudeTranscriptReadOptions,
): Effect.Effect<ClaudeTranscriptSource, ReadFailure> =>
  Effect.tryPromise({
    try: async () => {
      const target = parseClaudeTranscriptTarget(input.externalSessionId);
      if (!z.uuid().safeParse(target.sessionId).success) throw missingTranscript();
      const environment = options.processEnv ?? process.env;
      const config = resolve(environment.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize(
        "NFC",
      );
      const roots = await findTranscripts(
        join(config, "projects"),
        `${target.sessionId}.jsonl`,
        false,
      );
      if (roots.length === 0) throw missingTranscript();
      if (roots.length !== 1) {
        throw new AgentRuntimeQueryError(
          "request_failed",
          "Multiple Claude transcripts have this session ID. Remove the duplicate native transcript before loading this session.",
        );
      }
      const root = roots[0]!;
      const agentId = claudeSubagentAgentId(input.externalSessionId);
      if (!agentId) return { root, selected: root, sessionId: target.sessionId };
      if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw missingTranscript();
      const children = await findTranscripts(
        root.slice(0, -".jsonl".length) + "/subagents",
        `agent-${agentId.replace(/^agent-/, "")}.jsonl`,
        true,
      );
      if (children.length === 0) throw missingTranscript();
      if (children.length !== 1) {
        throw new AgentRuntimeQueryError(
          "request_failed",
          "Multiple Claude subagent transcripts have this agent ID. Remove the duplicate native transcript before loading this child.",
        );
      }
      return { root, selected: children[0]!, sessionId: target.sessionId };
    },
    catch: (cause): ReadFailure => {
      if (cause instanceof AgentRuntimeQueryError) return cause;
      if (isMissingFile(cause)) return missingTranscript();
      return sourceError("find", input.externalSessionId, cause);
    },
  });

export type ClaudeTranscriptSource = {
  readonly root: string;
  readonly selected: string;
  readonly sessionId: string;
};

const readResolvedClaudeTranscript = (
  input: LoadAgentSessionHistoryInput,
  options: ClaudeTranscriptReadOptions,
  paths: ClaudeTranscriptSource,
  expectedCwd: string,
  onReadSnapshot?: (path: string, before: string, after: string) => void,
): Effect.Effect<ClaudeTranscriptReadResult, ReadFailure> =>
  Effect.gen(function* () {
    const isChildTranscript = paths.selected !== paths.root;
    let cwd: string | undefined;
    const scopeRecord = (record: RecordValue): void => {
      const parsed = scopeMetadataSchema.safeParse(record);
      if (!parsed.success) throw sourceError("validate scope of", paths.root, parsed.error);
      const metadata = parsed.data;
      if (metadata.sessionId !== undefined && metadata.sessionId !== paths.sessionId)
        throw new AgentRuntimeQueryError(
          "scope_mismatch",
          "The Claude transcript contains another session ID. Check the source transcript on the host.",
        );
      if (!cwd && metadata.cwd !== undefined) cwd = metadata.cwd;
      if (metadata.type === "relocated" && metadata.relocatedCwd) cwd = metadata.relocatedCwd;
    };
    const recordFailure = (cause: unknown): ReadFailure =>
      isReadFailure(cause) ? cause : sourceError("validate records in", paths.selected, cause);
    const verifyScope = (): Effect.Effect<void, ReadFailure> =>
      Effect.gen(function* () {
        if (!cwd) return yield* Effect.fail(missingTranscript());
        if (cwd.normalize("NFC") !== expectedCwd.normalize("NFC") && cwd !== input.workingDirectory)
          return yield* Effect.fail(
            new AgentRuntimeQueryError(
              "scope_mismatch",
              "The Claude session belongs to another working directory. Select the matching session.",
            ),
          );
      });
    if (isChildTranscript) {
      yield* scanClaudeTranscript(
        paths.root,
        (record) => Effect.try({ try: () => scopeRecord(record), catch: recordFailure }),
        {
          mode: "scope",
          ...(onReadSnapshot && {
            onReadSnapshot: (before: string, after: string) =>
              onReadSnapshot(paths.root, before, after),
          }),
        },
      );
      yield* verifyScope();
    }
    const acquire =
      options.storage === "disk"
        ? createDiskClaudeTranscriptStorage<RecordValue>()
        : Effect.sync(() => createMemoryClaudeTranscriptStorage<RecordValue>());
    return yield* Effect.acquireUseRelease(
      acquire,
      (storage) =>
        Effect.gen(function* () {
          const graph: ClaudeTranscriptOrderMetadata[] = [];
          const queuedCommands = createClaudeTranscriptQueuedCommands();
          yield* scanClaudeTranscriptBatches(
            paths.selected,
            (records) =>
              Effect.gen(function* () {
                yield* Effect.try({
                  try: () => {
                    for (const record of records) {
                      if (
                        isChildTranscript &&
                        record.sessionId !== undefined &&
                        record.sessionId !== paths.sessionId
                      )
                        throw new AgentRuntimeQueryError(
                          "scope_mismatch",
                          "The Claude child transcript belongs to another session. Check its source file on the host.",
                        );
                      if (!isChildTranscript) scopeRecord(record);
                      queuedCommands.observe(record, graph.length);
                      graph.push(readClaudeTranscriptOrderMetadata(record));
                    }
                  },
                  catch: recordFailure,
                });
                yield* storage.appendBatch(records);
              }),
            onReadSnapshot
              ? { onReadSnapshot: (before, after) => onReadSnapshot(paths.selected, before, after) }
              : {},
          );
          if (!isChildTranscript) yield* verifyScope();
          const selected = selectClaudeTranscriptEntries(graph, {
            includeSidechains: isChildTranscript,
          });
          const normalizeQueuedCommand = queuedCommands.finish(selected);
          const messages: RecordValue[] = [];
          yield* storage.scan((record, index) =>
            Effect.sync(() => {
              if (!selected.has(index)) return;
              const message = normalizeQueuedCommand(record, index);
              if (!message) return;
              if (
                message.type !== "user" &&
                message.type !== "assistant" &&
                message.type !== "system" &&
                message.type !== "result" &&
                message.type !== "queue-operation"
              )
                return;
              message.session_id ??= paths.sessionId;
              message.parent_tool_use_id ??= null;
              if (message.compactMetadata !== undefined)
                message.compact_metadata ??= message.compactMetadata;
              messages.push(message);
            }),
          );
          if (messages.length === 0) return yield* Effect.fail(missingTranscript());
          return { messages, source: paths };
        }),
      (storage: ClaudeTranscriptStorage<RecordValue>) => storage.dispose(),
    );
  });

const resolveWorkingDirectory = (
  input: LoadAgentSessionHistoryInput,
): Effect.Effect<string, HostOperationError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        return await realpath(input.workingDirectory);
      } catch (cause) {
        if (
          isMissingFile(cause) &&
          input.sessionScope?.kind === "workflow" &&
          isAbsolute(input.workingDirectory)
        )
          return input.workingDirectory;
        throw cause;
      }
    },
    catch: (cause) => sourceError("resolve directory for", input.workingDirectory, cause),
  });

export const readClaudeTranscript = (
  input: LoadAgentSessionHistoryInput,
  options: ClaudeTranscriptReadOptions = {},
): Effect.Effect<ClaudeTranscriptReadResult, ReadFailure> =>
  Effect.gen(function* () {
    const paths = yield* resolveTranscriptPaths(input, options);
    const expectedCwd = yield* resolveWorkingDirectory(input);
    return yield* readResolvedClaudeTranscript(input, options, paths, expectedCwd);
  });

export type ManagedClaudeTranscriptReader = ClaudeTranscriptReader & { dispose(): void };

export const createClaudeTranscriptReader = (
  options: Pick<ClaudeTranscriptReadOptions, "processEnv" | "storage">,
): ManagedClaudeTranscriptReader => {
  const processEnv = { ...(options.processEnv ?? process.env) };
  const storage = options.storage ?? "memory";
  const readOptions = { processEnv, storage };
  let completed: { key: string; result: ClaudeTranscriptReadResult } | undefined;
  let version = 0;
  let disposed = false;
  return {
    read: (input) =>
      Effect.gen(function* () {
        if (disposed)
          return yield* new HostOperationError({
            operation: "claude.transcript.read",
            message:
              "The Claude transcript reader is closed. Reload the runtime before reading this session.",
          });
        const currentVersion = ++version;
        const paths = yield* resolveTranscriptPaths(input, readOptions);
        const expectedCwd = yield* resolveWorkingDirectory(input);
        const sourcePaths = [...new Set([paths.root, paths.selected])];
        const fingerprints = new Map<string, string>();
        for (const path of sourcePaths)
          fingerprints.set(path, yield* readClaudeTranscriptFingerprint(path));
        const key = JSON.stringify([expectedCwd, input.workingDirectory, paths, [...fingerprints]]);
        if (completed?.key === key) return completed.result;
        completed = undefined;
        const scanned = new Set<string>();
        let unchanged = true;
        const result = yield* readResolvedClaudeTranscript(
          input,
          readOptions,
          paths,
          expectedCwd,
          (path, before, after) => {
            scanned.add(path);
            if (before !== fingerprints.get(path) || before !== after) unchanged = false;
          },
        );
        for (const path of sourcePaths) {
          const after = yield* readClaudeTranscriptFingerprint(path);
          if (!scanned.has(path) || after !== fingerprints.get(path)) unchanged = false;
        }
        if (unchanged && !disposed && currentVersion === version) completed = { key, result };
        return result;
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            completed = undefined;
          }),
        ),
      ),
    dispose: () => {
      disposed = true;
      completed = undefined;
      version += 1;
    },
  };
};
