import { describe, expect, test } from "bun:test";
import type { CodexAppServerAccountRateLimitsResponse } from "@openducktor/contracts";
import {
  codexUsageLimitHistoryNotice,
  codexUsageRecovery,
  readCodexLatestUsageLimitStop,
} from "./codex-usage-limit";
import type { CodexAppServerClient } from "./types";

const NOW = 1_800_000_000_000;
const exhausted = (resetsAtSeconds: number) => ({
  limitId: "codex",
  primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: resetsAtSeconds },
  secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: resetsAtSeconds + 9_000 },
});
const read = (
  fields: Partial<CodexAppServerAccountRateLimitsResponse>,
): CodexAppServerAccountRateLimitsResponse => ({
  ordinaryUsageAllowed: false,
  rateLimits: exhausted(NOW / 1000 + 3_600),
  ...fields,
});
const usageLimitError = {
  message: "You've hit your usage limit.",
  codexErrorInfo: "usageLimitExceeded" as const,
  additionalDetails: null,
};

describe("Codex usage recovery", () => {
  test("only an allowed account read is a recovery", () => {
    expect(
      codexUsageRecovery(
        read({ ordinaryUsageAllowed: true, rateLimits: { limitId: "codex" } }),
        NOW,
      ),
    ).toEqual({ kind: "recovered" });
    expect(
      codexUsageRecovery(
        read({ ordinaryUsageAllowed: true, rateLimits: { spendControlReached: true } }),
        NOW,
      ),
    ).toEqual({ kind: "unknown" });
  });

  test("a blocked account waits for the latest reset of its exhausted windows", () => {
    expect(codexUsageRecovery(read({}), NOW)).toEqual({
      kind: "waiting",
      resetsAtEpochMs: NOW + 3_600_000,
    });
  });

  test("an unavailable permission or a passed reset leaves the manual Resume", () => {
    expect(codexUsageRecovery(read({ ordinaryUsageAllowed: null }), NOW)).toEqual({
      kind: "unknown",
    });
    expect(codexUsageRecovery(read({ rateLimits: exhausted(NOW / 1000 - 60) }), NOW)).toEqual({
      kind: "unknown",
    });
  });
});

describe("Codex usage-limit stop", () => {
  const turn = {
    id: "turn-limit",
    status: "failed" as const,
    error: usageLimitError,
    completedAt: NOW / 1000 - 60,
    startedAt: NOW / 1000 - 120,
  };

  test("reads the latest failed turn with the reset of the blocked account", async () => {
    const requests: Parameters<CodexAppServerClient["threadTurnsList"]>[0][] = [];
    const client: Pick<CodexAppServerClient, "threadTurnsList" | "accountRateLimitsRead"> = {
      threadTurnsList: async (params) => {
        requests.push(params);
        return {
          data: [{ ...turn, durationMs: null, items: [], itemsView: "notLoaded" }],
          backwardsCursor: null,
          nextCursor: null,
        };
      },
      accountRateLimitsRead: async () => read({}),
    };

    expect(await readCodexLatestUsageLimitStop(client, "thread-1", NOW)).toEqual({
      stopId: "turn-limit",
      occurredAtEpochMs: NOW - 60_000,
      resetsAtEpochMs: NOW + 3_600_000,
    });
    expect(requests).toEqual([
      {
        threadId: "thread-1",
        cursor: null,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      },
    ]);
  });

  test("history shows a usage-limit notice under the turn ID", () => {
    expect(codexUsageLimitHistoryNotice(turn)).toMatchObject({
      messageId: "turn-limit",
      role: "system",
      notice: { reason: "session_error", usageLimit: {} },
    });
    expect(
      codexUsageLimitHistoryNotice({
        ...turn,
        error: { ...usageLimitError, codexErrorInfo: null },
      }),
    ).toBeNull();
  });
});
