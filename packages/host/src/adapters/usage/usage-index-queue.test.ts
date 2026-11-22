import { describe, expect, test } from "bun:test";
import { knownRuntimeKindValues, type RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { createUsagePricer } from "../../domain/usage/usage-pricing";
import type { UsageIndexFigures } from "../../domain/usage/usage-report";
import { HostOperationError } from "../../effect/host-errors";
import { createUsageIndexQueue } from "./usage-index-queue";
import type { UsageIndexReadInput, UsageIndexReply } from "./usage-worker-protocol";

const FIGURES: UsageIndexFigures = {
  resultAtMs: 0,
  range: { start: "2026-11-01", end: "2026-11-01" },
  granularity: "day",
  periodBounds: [],
  withoutHistory: [],
  issues: [],
  byRuntime: [],
  periods: [],
  byModel: [],
  byProject: [],
  projects: [],
  pricing: { source: "models.dev", updatedAtMs: null, failure: null },
};

const input = (runtimes: readonly RuntimeKind[]): UsageIndexReadInput => ({
  timeZone: "UTC",
  runtimes,
  range: { start: null, end: "2026-11-01" },
  workspaces: [],
  refresh: false,
  separateFolders: [],
  locations: {
    claude: "/c",
    codex: [],
    opencode: { directory: "/o", databaseFile: null },
    antigravity: "/a",
  },
});

/** A queue over a fake index that logs its calls. A read of one runtime skips history. */
const harness = ({
  first = false,
  failRead = false,
  catchUpGate = Promise.resolve(),
  onCatchUp = () => {},
}: {
  first?: boolean;
  failRead?: boolean;
  catchUpGate?: Promise<void>;
  onCatchUp?: () => void;
} = {}) => {
  const calls: string[] = [];
  const replies: UsageIndexReply[] = [];
  let onIdle = () => {};
  const idle = () => new Promise<void>((resolve) => (onIdle = resolve));
  const nameOf = (read: UsageIndexReadInput) => read.runtimes.join("+");
  const queue = createUsageIndexQueue({
    index: {
      isFirstRead: () => Effect.succeed(first),
      stopParsing: () => void calls.push("stop"),
      needsCatchUp: (read) => read.runtimes.length < knownRuntimeKindValues.length,
      read: ({ input: read, first: isFirst, onProgress }) =>
        Effect.suspend(() => {
          calls.push(`read:${nameOf(read)}:${isFirst ? "first" : "later"}`);
          onProgress({
            phase: "reading",
            first: isFirst,
            summarized: 0,
            startedAt: "",
            runtimes: [],
          });
          return failRead
            ? Effect.fail(
                new HostOperationError({ operation: "usage.index.update", message: "Disk full." }),
              )
            : Effect.succeed(FIGURES);
        }),
      catchUp: ({ input: read }) =>
        Effect.sync(() => {
          calls.push(`catchUp:${nameOf(read)}`);
          onCatchUp();
        }).pipe(Effect.andThen(Effect.promise(() => catchUpGate))),
    },
    rates: {
      current: () =>
        Effect.sync(() => {
          calls.push("rates");
          return { pricer: createUsagePricer({}), updatedAtMs: null, failure: null };
        }),
    },
    reply: (message) => {
      replies.push(message);
      if (message.kind === "idle") onIdle();
    },
  });
  return { queue, calls, replies, idle, kinds: () => replies.map((reply) => reply.kind) };
};

describe("createUsageIndexQueue", () => {
  test("tells the clients about a first read before the rates and the read", async () => {
    const { queue, calls, replies, idle } = harness({ first: true });
    const done = idle();
    queue.read(1, input(knownRuntimeKindValues));
    await done;
    expect(calls).toEqual(["rates", "read:opencode+codex+claude+antigravity:first"]);
    expect(
      replies.map((reply) => (reply.kind === "progress" ? reply.progress.phase : reply.kind)),
    ).toEqual(["preparing", "reading", "result", "idle"]);
  });

  test("runs reads in arrival order and answers a canceled waiting read without a read", async () => {
    const { queue, calls, replies, idle } = harness();
    const done = idle();
    queue.read(1, input(knownRuntimeKindValues));
    queue.read(2, input(knownRuntimeKindValues));
    queue.cancel(2);
    await done;
    expect(calls).toEqual(["rates", "read:opencode+codex+claude+antigravity:later"]);
    expect(replies.filter((reply) => reply.kind !== "progress")).toEqual([
      { kind: "result", requestId: 1, result: FIGURES },
      { kind: "cancelled", requestId: 2 },
      { kind: "idle" },
    ]);
  });

  test("catches up skipped history after a read, and lets a new read go first", async () => {
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let started = () => {};
    const catchingUp = new Promise<void>((resolve) => (started = resolve));
    const { queue, calls, idle, kinds } = harness({
      catchUpGate: gate,
      onCatchUp: () => started(),
    });
    const done = idle();
    queue.read(1, input(["codex"]));
    // The catch-up starts after the first read and waits at its gate.
    await catchingUp;
    queue.read(2, input(knownRuntimeKindValues));
    open();
    await done;
    expect(calls).toEqual([
      "rates",
      "read:codex:later",
      "rates",
      "catchUp:codex",
      "stop",
      "rates",
      "read:opencode+codex+claude+antigravity:later",
      "rates",
      "catchUp:codex",
    ]);
    expect(kinds().filter((kind) => kind === "idle")).toHaveLength(1);
  });

  test("answers a failed read with the message of its failure", async () => {
    const { queue, replies, idle } = harness({ failRead: true });
    const done = idle();
    queue.read(1, input(knownRuntimeKindValues));
    await done;
    expect(replies.filter((reply) => reply.kind === "error")).toEqual([
      { kind: "error", requestId: 1, message: "Disk full." },
    ]);
  });
});
