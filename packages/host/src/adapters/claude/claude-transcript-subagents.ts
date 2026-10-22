import { lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { AgentRuntimeQueryError, type AgentSessionHistoryMessage } from "@openducktor/core";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { isLiveFinalAssistantStopReason } from "./claude-agent-sdk-history-assistant";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-messages";
import { readHistoryToolResults } from "./claude-agent-sdk-history-support";
import {
  parseClaudeHistoryAssistantEntry,
  type ClaudeProtocolObject,
} from "./claude-agent-sdk-ingress-schemas";
import { readStructuredClaudeAgentResult } from "./claude-agent-sdk-subagent-results";
import { readText } from "./claude-agent-sdk-utils";
import {
  CLAUDE_TRANSCRIPT_MISSING_MESSAGE,
  readClaudeTranscriptSidecar,
  scanClaudeTranscript,
} from "./claude-transcript-file";
import {
  readClaudeTranscriptOrderMetadata,
  selectClaudeTranscriptEntries,
} from "./claude-transcript-order";
import type { ClaudeTranscriptSource } from "./claude-transcript-reader";

type ReadFailure = HostOperationError | AgentRuntimeQueryError;
type ChildFile = { agentId: string; path: string };
type Completion = { complete: boolean; finalText: boolean };
const emptyCompletion: Completion = { complete: false, finalText: false };
const fileErrorSchema = z.object({ code: z.string() });
const sidecarSchema = z.object({
  toolUseId: z.string().optional(),
  parentAgentId: z.string().optional(),
});
const assistantSchema = z.object({
  stop_reason: z.string().nullable().optional(),
  content: z
    .array(z.object({ type: z.string().optional(), text: z.string().optional() }))
    .optional(),
});
const isMissing = (cause: unknown): boolean => {
  const parsed = fileErrorSchema.safeParse(cause);
  return parsed.success && parsed.data.code === "ENOENT";
};
const isMissingTranscript = (cause: ReadFailure): boolean =>
  cause instanceof AgentRuntimeQueryError &&
  cause.code === "request_failed" &&
  cause.message === CLAUDE_TRANSCRIPT_MISSING_MESSAGE;
const sourceError = (path: string, cause: unknown): HostOperationError =>
  new HostOperationError({
    operation: "claude.session.history.subagent-status",
    message: `Cannot read Claude subagent metadata '${path}': ${errorMessage(cause)}`,
    cause,
  });
const completionOf = (
  entry: ClaudeProtocolObject | ClaudeHistoryMessage | undefined,
): Completion => {
  if (entry?.type !== "assistant") return emptyCompletion;
  const parsed = assistantSchema.safeParse(entry.message);
  if (!parsed.success) return emptyCompletion;
  return {
    complete: isLiveFinalAssistantStopReason(parsed.data.stop_reason ?? undefined),
    finalText:
      parsed.data.content?.some((block) => block.type === "text" && Boolean(block.text?.trim())) ===
      true,
  };
};

const retractedIdsSchema = z.array(z.string());
const lastConversationCompletion = (
  records: readonly (ClaudeProtocolObject | ClaudeHistoryMessage)[],
  selected?: ReadonlySet<number>,
): Completion => {
  const retracted = new Set<string>();
  for (let index = 0; index < records.length; index++) {
    if (selected && !selected.has(index)) continue;
    const record = records[index];
    if (!record) continue;
    for (const field of [record.supersedes, record.retracted_message_uuids]) {
      const parsed = retractedIdsSchema.safeParse(field);
      if (parsed.success) for (const id of parsed.data) retracted.add(id);
    }
  }
  return completionOf(
    records.findLast(
      (record, index) =>
        (!selected || selected.has(index)) &&
        !retracted.has(readText(record.uuid) ?? "") &&
        (record.type === "assistant" || record.type === "user" || record.type === "system") &&
        "message" in record,
    ),
  );
};

export const createClaudeTranscriptSubagentReader = (
  source: ClaudeTranscriptSource,
  messages: readonly ClaudeHistoryMessage[],
) => {
  let childFiles: ChildFile[] | undefined;
  const completions = new Map<string, Completion>();
  const listChildren = (): Effect.Effect<ChildFile[], HostOperationError> =>
    Effect.gen(function* () {
      if (childFiles) return childFiles;
      const directory = join(source.root.slice(0, -".jsonl".length), "subagents");
      childFiles = yield* Effect.tryPromise({
        try: async () => {
          const files: ChildFile[] = [];
          const visit = async (path: string): Promise<void> => {
            if (!(await lstat(path)).isDirectory())
              throw new Error("The subagent directory must be a regular directory.");
            for (const entry of await readdir(path, { withFileTypes: true })) {
              const child = join(path, entry.name);
              if (entry.isDirectory()) await visit(child);
              else if (
                entry.isFile() &&
                entry.name.startsWith("agent-") &&
                entry.name.endsWith(".jsonl")
              ) {
                files.push({
                  agentId: basename(entry.name, ".jsonl").slice("agent-".length),
                  path: child,
                });
              }
            }
          };
          try {
            await lstat(directory);
          } catch (cause) {
            if (isMissing(cause)) return files;
            throw cause;
          }
          await visit(directory);
          return files;
        },
        catch: (cause) => sourceError(directory, cause),
      });
      return childFiles;
    });
  const readSidecar = (file: ChildFile): Effect.Effect<string | undefined, ReadFailure> =>
    Effect.gen(function* () {
      const path = file.path.replace(/\.jsonl$/, ".meta.json");
      const text = yield* readClaudeTranscriptSidecar(path).pipe(
        Effect.catch((cause) =>
          isMissingTranscript(cause) ? Effect.succeed(undefined) : Effect.fail(cause),
        ),
      );
      if (text === undefined) return undefined;
      return yield* Effect.try({
        try: () => sidecarSchema.parse(JSON.parse(text)).toolUseId,
        catch: (cause) => sourceError(path, cause),
      });
    });
  const readCompletion = (file: ChildFile): Effect.Effect<Completion, ReadFailure> =>
    Effect.gen(function* () {
      const cached = completions.get(file.path);
      if (cached) return cached;
      const records: ClaudeProtocolObject[] = [];
      yield* scanClaudeTranscript(
        file.path,
        (record) =>
          Effect.gen(function* () {
            if (record.sessionId !== undefined && record.sessionId !== source.sessionId)
              return yield* Effect.fail(
                new AgentRuntimeQueryError(
                  "scope_mismatch",
                  "The Claude child transcript belongs to another session. Check its source file on the host.",
                ),
              );
            records.push(record);
          }),
        { mode: "summary" },
      );
      const selected = yield* Effect.try({
        try: () =>
          selectClaudeTranscriptEntries(records.map(readClaudeTranscriptOrderMetadata), {
            includeSidechains: true,
          }),
        catch: (cause) => sourceError(file.path, cause),
      });
      const completion = lastConversationCompletion(records, selected);
      completions.set(file.path, completion);
      return completion;
    });
  return {
    correlations: (
      known: ReadonlyMap<string, string> = new Map(),
    ): Effect.Effect<Map<string, string>, ReadFailure> =>
      Effect.gen(function* () {
        const agentIds = new Map(known);
        const toolUseIds = new Set<string>();
        for (const entry of messages) {
          if (entry.type === "assistant") {
            for (const block of parseClaudeHistoryAssistantEntry(entry).message.content) {
              if (block.type !== "tool_use" || (block.name !== "Agent" && block.name !== "Task"))
                continue;
              const toolUseId = readText(block.id);
              if (toolUseId) toolUseIds.add(toolUseId);
            }
          } else if (entry.type === "user") {
            for (const result of readHistoryToolResults(entry)) {
              if (!toolUseIds.has(result.toolUseId)) continue;
              const structured = readStructuredClaudeAgentResult(result.raw);
              const agentId = readText(structured.agentId) ?? readText(structured.taskId);
              if (agentId) agentIds.set(result.toolUseId, agentId);
            }
          }
        }
        const unmatched = new Set([...toolUseIds].filter((id) => !agentIds.has(id)));
        if (unmatched.size === 0) return agentIds;
        for (const file of yield* listChildren()) {
          let toolUseId = yield* readSidecar(file);
          if (!toolUseId) {
            yield* scanClaudeTranscript(
              file.path,
              (record) =>
                Effect.sync(() => {
                  toolUseId ??= readText(record.parent_tool_use_id);
                }),
              { mode: "summary", range: { stopWhen: () => toolUseId !== undefined } },
            );
          }
          if (toolUseId && unmatched.delete(toolUseId)) agentIds.set(toolUseId, file.agentId);
          if (unmatched.size === 0) break;
        }
        return agentIds;
      }),
    reconcile: (history: AgentSessionHistoryMessage[]): Effect.Effect<void, ReadFailure> =>
      Effect.gen(function* () {
        const latest = new Map<
          string,
          {
            agentId: string | undefined;
            executionMode: "background" | "foreground" | undefined;
            status: string;
          }
        >();
        for (const message of history)
          for (const part of message.parts) {
            if (part.kind !== "subagent" || !part.externalSessionId) continue;
            const agentId =
              readText(part.metadata?.agentId) ?? latest.get(part.externalSessionId)?.agentId;
            latest.set(part.externalSessionId, {
              agentId,
              executionMode: part.executionMode,
              status: part.status,
            });
          }
        const running = [...latest.values()].filter(
          (part) => part.status === "running" && part.agentId,
        );
        if (running.length === 0) return;
        const files = yield* listChildren();
        const parent = lastConversationCompletion(messages);
        const statuses = new Map<string, "completed" | "cancelled">();
        for (const part of running) {
          const matches = files.filter((file) => file.agentId === part.agentId);
          if (matches.length > 1)
            return yield* Effect.fail(
              sourceError(
                part.agentId!,
                new Error("Multiple Claude child transcripts have this agent ID."),
              ),
            );
          const child = matches[0]
            ? yield* readCompletion(matches[0]).pipe(
                Effect.catch((cause) =>
                  isMissingTranscript(cause) ? Effect.succeed(emptyCompletion) : Effect.fail(cause),
                ),
              )
            : emptyCompletion;
          if (child.complete) statuses.set(part.agentId!, "completed");
          else if (part.executionMode !== "background" && parent.complete)
            statuses.set(part.agentId!, child.finalText ? "completed" : "cancelled");
        }
        for (const message of history)
          message.parts = message.parts.map((part) => {
            if (part.kind !== "subagent" || part.status !== "running") return part;
            const agentId = readText(part.metadata?.agentId);
            const status = agentId ? statuses.get(agentId) : undefined;
            return status ? { ...part, status } : part;
          });
      }),
  };
};
