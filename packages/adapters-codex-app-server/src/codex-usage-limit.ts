import type {
  AgentSessionHistoryMessage,
  UsageLimitRecovery,
  UsageLimitStop,
} from "@openducktor/core";
import type {
  AgentSessionUsageLimit,
  CodexAppServerAccountRateLimitsResponse,
  CodexAppServerRateLimitSnapshot,
  CodexAppServerTurn,
} from "@openducktor/contracts";
import { timestampFromCodexTurn } from "./codex-app-server-transcript";
import type { CodexAppServerClient } from "./types";

/** The text of a usage-limit turn error when Codex sends none. */
export const CODEX_USAGE_LIMIT_MESSAGE = "Codex reached the usage limit.";

/** Codex ends a turn on a usage limit with this error code, without its reset time. */
export const isCodexUsageLimitTurn = (
  turn: Pick<CodexAppServerTurn, "status" | "error">,
): boolean => turn.status === "failed" && turn.error?.codexErrorInfo === "usageLimitExceeded";

/** The time a turn ended, or started when Codex has no end time. */
const codexTurnEndedAt = (
  turn: Pick<CodexAppServerTurn, "completedAt" | "startedAt">,
): string | null =>
  timestampFromCodexTurn(turn, "completedAt") ?? timestampFromCodexTurn(turn, "startedAt");

/**
 * The latest reset among the exhausted windows of a usage snapshot. Codex reports `resetsAt` in
 * Unix seconds. The account can work again only after every exhausted window resets.
 */
const codexExhaustedResetEpochMs = (
  snapshot: CodexAppServerRateLimitSnapshot,
): number | undefined => {
  const resets = [snapshot.primary, snapshot.secondary].flatMap((window) =>
    window?.resetsAt !== null && window?.resetsAt !== undefined && window.usedPercent >= 100
      ? [window.resetsAt * 1000]
      : [],
  );
  return resets.length > 0 ? Math.max(...resets) : undefined;
};

/**
 * The usage limit of a failed turn, from the usage snapshot that Codex sends for the failed
 * request just before the turn ends.
 */
export const codexTurnUsageLimit = (
  snapshot: CodexAppServerRateLimitSnapshot | undefined,
): AgentSessionUsageLimit => {
  const resetsAtEpochMs = snapshot ? codexExhaustedResetEpochMs(snapshot) : undefined;
  return resetsAtEpochMs === undefined ? {} : { resetsAtEpochMs };
};

/**
 * Reads recovery with the rule of the Codex terminal UI: only a full account read with
 * `ordinaryUsageAllowed` can prove it. Percentages and reset times only tell when to read again.
 */
export const codexUsageRecovery = (
  read: CodexAppServerAccountRateLimitsResponse,
  nowEpochMs: number,
): UsageLimitRecovery => {
  if (read.ordinaryUsageAllowed === null || read.ordinaryUsageAllowed === undefined)
    return { kind: "unknown" };
  const credits = read.rateLimits.credits;
  const hasUsableCredits = credits?.unlimited === true || credits?.hasCredits === true;
  if (
    (read.ordinaryUsageAllowed || hasUsableCredits) &&
    read.rateLimitUpsell == null &&
    read.rateLimits.spendControlReached !== true &&
    read.rateLimits.rateLimitReachedType == null
  )
    return { kind: "recovered" };
  const resets = [read.rateLimits, ...Object.values(read.rateLimitsByLimitId ?? {})].flatMap(
    (snapshot) => {
      const reset = codexExhaustedResetEpochMs(snapshot);
      return reset !== undefined && reset > nowEpochMs ? [reset] : [];
    },
  );
  return resets.length > 0
    ? { kind: "waiting", resetsAtEpochMs: Math.max(...resets) }
    : { kind: "unknown" };
};

/**
 * Reads the latest turn of a thread. A turn that failed on the usage limit is a stop, named by its
 * turn ID as the live `turn_error` is. Its reset time is set only while the account still waits.
 */
export const readCodexLatestUsageLimitStop = async (
  client: Pick<CodexAppServerClient, "threadTurnsList" | "accountRateLimitsRead">,
  threadId: string,
  nowEpochMs: number,
): Promise<UsageLimitStop | null> => {
  const { data } = await client.threadTurnsList({
    threadId,
    cursor: null,
    limit: 1,
    sortDirection: "desc",
    itemsView: "notLoaded",
  });
  const turn = data[0];
  if (!turn || !isCodexUsageLimitTurn(turn)) return null;
  const endedAt = codexTurnEndedAt(turn);
  if (endedAt === null) return null;
  const stop: UsageLimitStop = { stopId: turn.id, occurredAtEpochMs: Date.parse(endedAt) };
  const recovery = codexUsageRecovery(await client.accountRateLimitsRead(), nowEpochMs);
  return recovery.kind === "waiting"
    ? { ...stop, resetsAtEpochMs: recovery.resetsAtEpochMs }
    : stop;
};

/**
 * The error notice of a turn that failed on the usage limit, as the live `turn_error` shows it.
 * History has no reset time, so a planned auto-resume or the manual Resume decides what follows.
 */
export const codexUsageLimitHistoryNotice = (
  turn: Pick<CodexAppServerTurn, "id" | "status" | "error" | "completedAt" | "startedAt">,
): AgentSessionHistoryMessage | null => {
  const endedAt = codexTurnEndedAt(turn);
  if (!isCodexUsageLimitTurn(turn) || endedAt === null) return null;
  return {
    messageId: turn.id,
    role: "system",
    timestamp: endedAt,
    text: turn.error?.message ?? CODEX_USAGE_LIMIT_MESSAGE,
    notice: { tone: "error", reason: "session_error", title: "Error", usageLimit: {} },
    parts: [],
  };
};
