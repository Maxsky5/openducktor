import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import type {
  ClaudeGoalEvent,
  ClaudeNativeGoal,
  ClaudeSessionContext,
} from "./claude-agent-sdk-types";
import { scanClaudeTranscriptBatches } from "./claude-transcript-file";
import { findClaudeRootTranscript } from "./claude-transcript-reader";
import { textFromContentBlocks } from "./claude-agent-sdk-utils";
import { scanClaudeTranscriptForGoalRecords } from "./claude-goal-transcript-scan";

/**
 * Claude Code 2.1.306 to 2.1.319 keeps the goal of a session in `goal_status` attachment records of
 * its session transcript, and restores an unfinished goal from them on resume:
 * - `/goal <condition>` writes `{ met: false, sentinel: true, condition }`.
 * - `/goal clear` and an unrecoverable error write `{ met: true, sentinel: true, condition }`.
 * - Each failed check at a turn end writes `{ met: false, condition, reason }`.
 * - A met goal writes `{ met: true, condition, ... }`, and an impossible goal `{ failed: true }`.
 * A local session gets no goal state on the SDK stream, so the adapter reads these records.
 */
type ClaudeGoalRecord = {
  readonly kind: "set" | "not_met" | "met" | "failed" | "clear";
  readonly objective: string;
};

const goalStatusRecordSchema = z.looseObject({
  type: z.literal("attachment"),
  attachment: z.looseObject({
    type: z.literal("goal_status"),
    condition: z.string().trim().min(1),
    met: z.boolean().optional(),
    failed: z.boolean().optional(),
    sentinel: z.boolean().optional(),
  }),
});

const readClaudeGoalRecord = (record: ClaudeProtocolObject): ClaudeGoalRecord | null => {
  const parsed = goalStatusRecordSchema.safeParse(record);
  if (!parsed.success) return null;
  const { condition, met, failed, sentinel } = parsed.data.attachment;
  const objective = condition;
  if (sentinel === true) return { kind: met === true ? "clear" : "set", objective };
  if (failed === true) return { kind: "failed", objective };
  return { kind: met === true ? "met" : "not_met", objective };
};

const graphRecordSchema = z.looseObject({
  type: z.string(),
  uuid: z.string().min(1).optional(),
  parentUuid: z.string().min(1).nullable().optional(),
  isSidechain: z.boolean().optional(),
});

const CHAIN_RECORD_TYPES = new Set(["user", "assistant", "attachment", "system"]);

/**
 * The goal that Claude restores from a transcript. It follows `parentUuid` back from the leaf and
 * takes the last `goal_status` record, as Claude does. A compact boundary has no parent, so the
 * walk stops there, and it never follows `logicalParentUuid`. A met, failed, or cleared goal does
 * not come back.
 */
type GoalGraphEntry = { parentUuid?: string; goal: ClaudeGoalRecord | null };

export const restoreClaudeGoalFromRecords = (
  records: readonly ClaudeProtocolObject[],
): ClaudeNativeGoal | null => {
  const graph = new Map<string, GoalGraphEntry>();
  let leaf: string | undefined;
  for (const record of records) {
    const parsed = graphRecordSchema.safeParse(record);
    if (!parsed.success || !parsed.data.uuid) continue;
    const { uuid, parentUuid, type, isSidechain } = parsed.data;
    const entry: GoalGraphEntry = { goal: readClaudeGoalRecord(record) };
    if (parentUuid) entry.parentUuid = parentUuid;
    graph.set(uuid, entry);
    if (isSidechain !== true && CHAIN_RECORD_TYPES.has(type)) leaf = uuid;
  }
  const visited = new Set<string>();
  let current = leaf;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const entry = graph.get(current);
    if (!entry) return null;
    if (entry.goal) {
      return entry.goal.kind === "set" || entry.goal.kind === "not_met"
        ? { objective: entry.goal.objective }
        : null;
    }
    current = entry.parentUuid;
  }
  return null;
};

/** The goal commands that Claude runs. Claude cannot pause or resume a goal. */
export type ClaudeGoalCommand =
  | { readonly kind: "set"; readonly objective: string }
  | { readonly kind: "clear" };

type PendingGoalCommand = ClaudeGoalCommand & {
  /** The text of the goal command reply, which carries the refusal reason. */
  output?: string;
  /**
   * `sent`: Claude has not replied. `replied`: the reply came. `checking`: a set ended with no model
   * turn, and the transcript read runs before the refusal.
   */
  phase: "sent" | "replied" | "checking";
  readonly settle: (error?: Error) => void;
};

/** The adapter view of the native goal of one session, and its transcript read position. */
export type ClaudeGoalTracking = {
  goal: ClaudeNativeGoal | null;
  path: string | null;
  offset: number;
  reads: Promise<void>;
  pending: PendingGoalCommand | null;
  /** `/goal clear` commands that OpenDucktor sent and whose record it has not read yet. */
  clearsSent: number;
  /** The read of the goal that Claude restores from the transcript. It rejects when the read failed. */
  restore: Promise<void>;
};

type ClaudeGoalSession = Pick<ClaudeSessionContext, "externalSessionId" | "goalTracking"> & {
  readonly transcriptEnvironment?: NodeJS.ProcessEnv | undefined;
};

const trackingOf = (session: ClaudeGoalSession): ClaudeGoalTracking => {
  session.goalTracking ??= {
    goal: null,
    path: null,
    offset: 0,
    reads: Promise.resolve(),
    pending: null,
    clearsSent: 0,
    restore: Promise.resolve(),
  };
  return session.goalTracking;
};

const transcriptPath = async (session: ClaudeGoalSession): Promise<string | null> => {
  const tracking = trackingOf(session);
  tracking.path ??= await findClaudeRootTranscript(
    session.transcriptEnvironment ?? process.env,
    session.externalSessionId,
  );
  return tracking.path;
};

const readRecords = (
  path: string,
  startByte: number | undefined,
): Promise<{ records: ClaudeProtocolObject[]; end: number }> => {
  const records: ClaudeProtocolObject[] = [];
  let end = startByte ?? 0;
  const options: Parameters<typeof scanClaudeTranscriptBatches>[2] = {
    mode: "goal",
    onEnd: (value) => {
      end = value;
    },
  };
  if (startByte !== undefined) options.range = { startByte };
  return Effect.runPromise(
    scanClaudeTranscriptBatches(
      path,
      (batch) =>
        Effect.sync(() => {
          for (const record of batch) records.push(record);
        }),
      options,
    ),
  ).then(() => ({ records, end }));
};

const goalEvent = (
  session: ClaudeGoalSession,
  timestamp: string,
  goal: ClaudeNativeGoal | null,
): ClaudeGoalEvent => {
  const event: ClaudeGoalEvent = {
    type: "session_goal_updated",
    externalSessionId: session.externalSessionId,
    timestamp,
    goal,
  };
  return goal && session.goalTracking?.pending?.kind === "clear"
    ? { ...event, clearing: true }
    : event;
};

/** The event that publishes the goal that the adapter tracks for the session now. */
export const currentClaudeGoalEvent = (
  session: ClaudeGoalSession,
  timestamp: string,
): ClaudeGoalEvent => goalEvent(session, timestamp, session.goalTracking?.goal ?? null);

/**
 * Starts to read the goal that Claude restores for the session from its whole transcript, and
 * moves the live read position to the end of that transcript. A session that already tracks its
 * goal keeps it, also an ended goal that a new read would drop. The returned Promise settles
 * with the read.
 */
export const beginClaudeGoalRestore = (session: ClaudeGoalSession): Promise<void> => {
  if (session.goalTracking) return session.goalTracking.restore;
  const tracking = trackingOf(session);
  const read = tracking.reads.then(async () => {
    const path = await transcriptPath(session);
    if (!path) return;
    const scan = await scanClaudeTranscriptForGoalRecords(path, 0);
    if (!scan.hasGoalRecord) {
      tracking.goal = null;
      tracking.offset = scan.end;
      return;
    }
    const { records, end } = await readRecords(path, undefined);
    tracking.goal = restoreClaudeGoalFromRecords(records);
    tracking.offset = end;
  });
  tracking.reads = read.catch(() => {});
  tracking.restore = read;
  return read;
};

/** Waits for the restored goal of the session, and returns the event that publishes it. */
export const restoreClaudeSessionGoal = async (
  session: ClaudeGoalSession,
  timestamp: string,
): Promise<ClaudeGoalEvent> => {
  await beginClaudeGoalRestore(session);
  await session.goalTracking?.reads;
  return currentClaudeGoalEvent(session, timestamp);
};

/** Sets the goal of the session and publishes it when it changed. */
const publishGoal = (
  session: ClaudeGoalSession,
  tracking: ClaudeGoalTracking,
  goal: ClaudeNativeGoal | null,
  emit: (event: ClaudeGoalEvent) => void,
  now: () => string,
): void => {
  const before = tracking.goal;
  tracking.goal = goal;
  if (!sameGoal(before, goal)) emit(goalEvent(session, now(), goal));
};

const sameGoal = (left: ClaudeNativeGoal | null, right: ClaudeNativeGoal | null): boolean =>
  left === right ||
  (left !== null && right !== null && left.objective === right.objective && left.end === right.end);

const applyRecord = (tracking: ClaudeGoalTracking, record: ClaudeGoalRecord): void => {
  const { objective } = record;
  switch (record.kind) {
    case "set":
      tracking.goal = { objective };
      tracking.clearsSent = 0;
      if (tracking.pending?.kind === "set" && tracking.pending.objective === objective)
        tracking.pending.settle();
      return;
    case "not_met":
      tracking.goal = { objective };
      return;
    case "met":
    case "failed":
      tracking.goal = { objective, end: record.kind };
      return;
    case "clear":
      if (tracking.clearsSent > 0) {
        tracking.clearsSent -= 1;
        tracking.goal = null;
      } else {
        // Claude clears a goal by itself only after an unrecoverable error.
        tracking.goal = { objective, end: "stopped" };
      }
  }
};

/** Reads the transcript lines that Claude wrote since the last read. */
const readNewRecords = (
  session: ClaudeGoalSession,
  emit: (event: ClaudeGoalEvent) => void,
  now: () => string,
): Promise<void> => {
  const tracking = trackingOf(session);
  const read = tracking.reads.then(async () => {
    const path = await transcriptPath(session);
    if (!path) return;
    // New tool output can be large, and only goal records matter here.
    const scan = await scanClaudeTranscriptForGoalRecords(path, tracking.offset);
    if (!scan.hasGoalRecord) {
      tracking.offset = scan.end;
      return;
    }
    const before = tracking.goal;
    const { records, end } = await readRecords(path, tracking.offset);
    tracking.offset = end;
    for (const record of records) {
      const goal = readClaudeGoalRecord(record);
      if (goal) applyRecord(tracking, goal);
    }
    if (!sameGoal(before, tracking.goal)) emit(goalEvent(session, now(), tracking.goal));
  });
  tracking.reads = read.catch(() => {});
  return read;
};

const goalCommandReplySchema = z.looseObject({
  type: z.literal("assistant"),
  parent_tool_use_id: z.null(),
  local_command_run: z.looseObject({ command: z.literal("goal"), args: z.string() }),
  message: z.looseObject({
    content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  }),
});

const isTurnFrame = (message: SDKMessage): boolean =>
  message.type === "stream_event" ||
  (message.type === "assistant" && !isClaudeSyntheticAssistantMessage(message));

/**
 * Follows the goal through the SDK stream of a root session. The reply of a `/goal` command
 * settles a clear. Claude starts a model turn after a `/goal <condition>` only when it set the
 * goal, and it answers a refusal with text alone. So the first model frame after the reply settles
 * a set. A result with no model frame reads the transcript: a set record there means that the
 * turn failed before the model answered, and no record means a refusal, which the reply names.
 * Each turn result with a goal reads the new records, because Claude checks the goal at the end of
 * the turn.
 */
export const observeClaudeGoalFrame = ({
  emit,
  message,
  now,
  onFailure,
  session,
}: {
  emit: (event: ClaudeGoalEvent) => void;
  message: SDKMessage;
  now: () => string;
  onFailure: (error: HostOperationError) => void;
  session: ClaudeGoalSession;
}): void => {
  const tracking = session.goalTracking;
  if (!tracking) return;
  const pending = tracking.pending;
  // Only a command reply carries `local_command_run`, so other frames skip the schema parse.
  const reply =
    message.type === "assistant" && "local_command_run" in message
      ? goalCommandReplySchema.safeParse(message)
      : null;
  if (reply?.success) {
    if (pending?.phase !== "sent") return;
    pending.phase = "replied";
    pending.output = textFromContentBlocks(reply.data.message.content).trim();
    if (pending.kind === "clear") {
      publishGoal(session, tracking, null, emit, now);
      pending.settle();
    }
    return;
  }
  const read = () =>
    readNewRecords(session, emit, now).catch((cause: unknown) => {
      const error = new HostOperationError({
        operation: "claude.goal.read",
        message: `Cannot read the Claude goal of session '${session.externalSessionId}': ${errorMessage(cause)}`,
        cause,
      });
      if (tracking.pending) tracking.pending.settle(error);
      else onFailure(error);
    });
  if (pending?.kind === "set" && pending.phase === "replied") {
    if (isTurnFrame(message)) {
      publishGoal(session, tracking, { objective: pending.objective }, emit, now);
      tracking.clearsSent = 0;
      pending.settle();
      return;
    }
    if (message.type === "result") {
      pending.phase = "checking";
      void read().then(() =>
        pending.settle(
          new HostValidationError({
            field: "goal",
            message: pending.output || "Claude did not set the goal.",
          }),
        ),
      );
      return;
    }
  }
  if (message.type === "result" && tracking.goal && !tracking.goal.end) void read();
};

/**
 * Registers a goal command before the adapter sends it. The returned Promise settles when Claude
 * reports the outcome of the command.
 */
export type ClaudeGoalCommandWait = {
  readonly outcome: Promise<void>;
  readonly cancel: () => void;
};

export const beginClaudeGoalCommand = (
  session: ClaudeGoalSession,
  command: ClaudeGoalCommand,
): ClaudeGoalCommandWait => {
  const tracking = trackingOf(session);
  if (tracking.pending)
    throw new HostValidationError({
      field: "goal",
      message: "Another goal action is still running. Wait for it to finish, then try again.",
    });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const pending: PendingGoalCommand = {
    ...command,
    phase: "sent",
    settle: (error) => {
      if (tracking.pending !== pending) return;
      tracking.pending = null;
      if (error) {
        if (command.kind === "clear") tracking.clearsSent = Math.max(0, tracking.clearsSent - 1);
        reject(error);
      } else resolve();
    },
  };
  tracking.pending = pending;
  if (command.kind === "clear") tracking.clearsSent += 1;
  return { outcome: promise, cancel: () => pending.settle(new Error("The goal action stopped.")) };
};

/** Ends the goal command of a session whose stream stopped. */
export const rejectPendingClaudeGoalCommand = (session: ClaudeGoalSession, reason: Error): void =>
  session.goalTracking?.pending?.settle(reason);

/** Removes a goal that Claude already ended. Claude needs no command for it. */
export const forgetEndedClaudeGoal = (
  session: ClaudeGoalSession,
  timestamp: string,
): ClaudeGoalEvent | null => {
  const tracking = session.goalTracking;
  if (!tracking?.goal?.end) return null;
  tracking.goal = null;
  return goalEvent(session, timestamp, null);
};
