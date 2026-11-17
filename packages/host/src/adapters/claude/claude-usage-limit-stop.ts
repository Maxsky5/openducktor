import { stat } from "node:fs/promises";
import type { SessionRef, UsageLimitStop } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { ClaudeAgentSdkServiceError } from "../../application/runtimes/claude-agent-sdk-service";

import {
  type ClaudeHistoryMessage,
  loadClaudeSessionMessages,
} from "./claude-agent-sdk-history-messages";
import { scanClaudeTranscriptForMark } from "./claude-transcript-mark-scan";
import { toAssistantErrorNotice } from "./claude-agent-sdk-history-assistant";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { readStringProp, toClaudeServiceError } from "./claude-agent-sdk-utils";
import { findClaudeRootTranscript, type ClaudeTranscriptReader } from "./claude-transcript-reader";

/**
 * The usage-limit stop that ends the latest main-chain turn, or `null`. A later user prompt or
 * assistant reply is new work. Results, system records, and meta user records are not.
 */
export const latestClaudeUsageLimitStop = (
  messages: readonly ClaudeHistoryMessage[],
): UsageLimitStop | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index]!;
    if (entry.type === "user" && entry.isMeta !== true) return null;
    if (entry.type !== "assistant") continue;
    const timestamp = readStringProp(entry, "timestamp") ?? "";
    const occurredAtEpochMs = Date.parse(timestamp);
    // The history notice and the live `turn_error` of this entry carry the same ID.
    const notice = toAssistantErrorNotice(entry, timestamp);
    const usageLimit = notice?.notice.usageLimit;
    if (!notice || !usageLimit || !Number.isFinite(occurredAtEpochMs)) return null;
    const stop: UsageLimitStop = { stopId: notice.messageId, occurredAtEpochMs };
    return usageLimit.resetsAtEpochMs === undefined
      ? stop
      : { ...stop, resetsAtEpochMs: usageLimit.resetsAtEpochMs };
  }
  return null;
};

// A raw byte scan lets transcripts without a usage-limit error skip the parse.
const RATE_LIMIT_MARK = Buffer.from('"rate_limit"');
/**
 * After the error of a usage-limit stop, Claude Code writes only small records, such as the last
 * prompt and the cost state. So a stop that ends the latest turn is in the end of the file, and
 * an old stop in a long transcript costs no parse at each host start. A stop with more trailing
 * bytes keeps the manual Resume.
 */
export const USAGE_LIMIT_SCAN_TAIL_BYTES = 256 * 1024;

/** Reads the usage-limit stop that ends the latest turn of a root Claude session. */
export const readClaudeLatestUsageLimitStop = (
  ref: SessionRef,
  reader: ClaudeTranscriptReader,
  processEnv: NodeJS.ProcessEnv = process.env,
): Effect.Effect<UsageLimitStop | null, ClaudeAgentSdkServiceError> =>
  Effect.gen(function* () {
    const target = parseClaudeTranscriptTarget(ref.externalSessionId);
    if (target.subpath) return null;
    const scan = yield* Effect.tryPromise({
      try: async () => {
        const path = await findClaudeRootTranscript(processEnv, target.sessionId);
        if (!path) return null;
        const { size } = await stat(path);
        const start = Math.max(0, size - USAGE_LIMIT_SCAN_TAIL_BYTES);
        return scanClaudeTranscriptForMark(path, start, RATE_LIMIT_MARK);
      },
      catch: (cause) => toHostOperationError(cause, "claude.transcript.scan-usage-limit"),
    });
    if (!scan?.found) return null;
    const messages = yield* loadClaudeSessionMessages(
      { ...ref, runtimeKind: "claude", runtimePolicy: { kind: "claude" } },
      { reader },
    );
    return latestClaudeUsageLimitStop(messages);
  }).pipe(
    Effect.mapError((cause) =>
      toClaudeServiceError("claudeRuntime.readLatestUsageLimitStop", cause),
    ),
  );
