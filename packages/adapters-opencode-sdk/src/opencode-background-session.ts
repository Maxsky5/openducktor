import type {
  OpenCodeClient,
  SessionInboxInfo,
  SessionMessageAssistantTool,
} from "@opencode/client";
import {
  type AgentEvent,
  type AgentSessionBackgroundWork,
  BACKGROUND_STOP_ROUNDS,
  type SessionRef,
  stopBackgroundWork,
} from "@openducktor/core";
import {
  OpenCodeBackgroundTasks,
  type OpenCodeBackgroundEntry,
  type OpenCodeExecutionEnd,
  type OpenCodeExecutionEndWatch,
} from "./opencode-background-tasks";
import { nativeRequest, operationError } from "./opencode-client";
import { keptResultMetadata } from "./opencode-kept-result";
import { createOpenCodeMessageId } from "./opencode-message-id";
import type { OpencodeSessionRuntimeSignal } from "./opencode-session-runtime-signals";

type SessionIdle = Extract<AgentEvent, { type: "session_idle" }>;
type ReplyEnd = Extract<AgentEvent, { type: "session_idle" | "session_status" }>;

/**
 * The background work of the sessions of one OpenCode runtime: the task ledger, the signals that
 * report it, the reply ends that it keeps running, and the stops of tasks and session trees.
 */
export const createOpenCodeBackgroundSession = ({
  client,
  parentOf,
  emit,
  isReplying,
}: {
  readonly client: OpenCodeClient;
  readonly parentOf: (sessionID: string) => string | undefined;
  readonly emit: (signal: OpencodeSessionRuntimeSignal) => void;
  /** Tells if the session runs a reply or waits for one, so its work end makes it not idle. */
  readonly isReplying: (sessionID: string) => boolean;
}) => {
  const tasks = new OpenCodeBackgroundTasks(parentOf);
  /** The interruption notice of a reply that ended while background work remained. */
  const interruptions = new Map<string, NonNullable<SessionIdle["interruption"]>>();

  /** Reports the background work of the session tree of `sessionID`. */
  const reportWork = (sessionID: string): AgentSessionBackgroundWork => {
    const work = tasks.work(sessionID);
    emit({
      type: "background_updated",
      externalSessionId: sessionID,
      tasks: work.tasks,
      resultPending: work.resultPending,
    });
    return work;
  };

  /**
   * Reports the background work of each session of the chain. A session that waited only on
   * background work becomes idle when the last task result reaches its agent.
   */
  const reportBackground = (
    chain: readonly string[],
    before: readonly boolean[],
    timestamp: string,
  ): void => {
    for (const [index, sessionID] of chain.entries()) {
      const work = reportWork(sessionID);
      if (!before[index] || work.tasks.length > 0 || work.resultPending) continue;
      if (isReplying(sessionID)) continue;
      const idle: SessionIdle = { type: "session_idle", externalSessionId: sessionID, timestamp };
      const interruption = interruptions.get(sessionID);
      if (interruption) idle.interruption = interruption;
      interruptions.delete(sessionID);
      emit({ type: "session_event", externalSessionId: sessionID, event: idle });
    }
  };

  const changeBackground = (sessionID: string, timestamp: string, change: () => boolean) => {
    // An empty ledger gives no session work, so the walk up the parents waits for a change.
    const before = tasks.isEmpty ? [] : tasks.chain(sessionID).map((id) => tasks.hasWork(id));
    if (change()) reportBackground(tasks.chain(sessionID), before, timestamp);
  };

  const stopNativeTask = (ref: SessionRef, entry: OpenCodeBackgroundEntry) =>
    nativeRequest(ref, "stop a background task", async () => {
      if (entry.target.kind === "shell")
        await client.shell.remove({
          id: entry.target.shellID,
          location: { directory: entry.target.directory },
        });
      else if (entry.target.kind === "job")
        await client.experimental.job.cancel({ id: entry.target.jobID });
      // A round whose child execution ended waits for its report, which ends its task.
      else if (!entry.round || isReplying(entry.target.childID))
        await client.session.interrupt({ sessionID: entry.target.childID });
    });

  /** Fails Stop session with the reason when a wait of the cleanup fails. */
  const observeCleanup = (ref: SessionRef, wait: Promise<unknown>): Promise<void> =>
    wait.then(
      () => undefined,
      (cause: unknown) => {
        throw operationError(
          ref,
          "stop the background tasks",
          "runtime_unavailable",
          cause instanceof Error ? cause.message : String(cause),
        );
      },
    );

  return {
    hasWork: (sessionID: string): boolean => tasks.hasWork(sessionID),
    /** The session and its ancestors, from the session up. */
    chain: (sessionID: string): string[] => tasks.chain(sessionID),
    /** A new reply runs, so the notice of an earlier interrupted reply no longer applies. */
    replyStarted: (sessionID: string): void => {
      interruptions.delete(sessionID);
    },
    /**
     * The end of a reply while background work remains. The session stays running, so the reply
     * end gives no idle signal.
     */
    replyEnd: (projected: ReplyEnd, completionId: string): AgentEvent => {
      if (projected.type === "session_idle" && projected.turnOutcome) {
        if (projected.interruption)
          interruptions.set(projected.externalSessionId, projected.interruption);
        return {
          type: "session_turn_finished",
          externalSessionId: projected.externalSessionId,
          timestamp: projected.timestamp,
          completionId,
          messageIds: [],
          turnOutcome: projected.turnOutcome,
        };
      }
      return {
        type: "session_status",
        externalSessionId: projected.externalSessionId,
        timestamp: projected.timestamp,
        status: { type: "busy", message: null },
        foregroundTurnActive: false,
      };
    },
    executionEnded: (sessionID: string): void => tasks.executionEnded(sessionID),
    startCall: (
      sessionID: string,
      directory: string,
      part: SessionMessageAssistantTool,
      timestamp: string,
    ): void =>
      changeBackground(sessionID, timestamp, () => tasks.startCall(sessionID, directory, part)),
    /** A child execution starts. A round that no call of the parent started is a parent task. */
    childExecutionStarted: (
      childID: string,
      parentID: string,
      runID: string,
      child: { readonly agent: string; readonly title?: string | undefined },
      timestamp: string,
    ): void =>
      changeBackground(parentID, timestamp, () =>
        tasks.startRound(childID, parentID, runID, child),
      ),
    childStepStarted: (childID: string): void => tasks.stepRound(childID),
    /** A child execution ends. A round that sends no report ends its task here. */
    childExecutionEnded: (
      childID: string,
      parentID: string,
      end: OpenCodeExecutionEnd,
      timestamp: string,
    ): void => changeBackground(parentID, timestamp, () => tasks.endRound(childID, end)),
    notice: (sessionID: string, item: SessionInboxInfo, timestamp: string): void =>
      changeBackground(sessionID, timestamp, () => tasks.notice(sessionID, item)),
    jobCancelled: (sessionID: string, jobID: string, timestamp: string): void =>
      changeBackground(sessionID, timestamp, () => tasks.jobCancelled(sessionID, jobID)),
    settle: (sessionID: string, inboxID: string, delivered: boolean, timestamp: string): void =>
      changeBackground(sessionID, timestamp, () => tasks.settle(sessionID, inboxID, delivered)),
    /** Records that the adapter cannot tell which background tasks the session has. */
    lose: (sessionID: string, cause: Error): void => tasks.lose(sessionID, cause),
    /**
     * OpenCode removed the session with its child sessions and their jobs. Read the ancestors
     * before the binding of the session goes. Run the returned report after the removal signal.
     */
    removeSession: (sessionID: string, timestamp: string): (() => void) => {
      const ancestors = tasks.chain(sessionID).slice(1);
      const before = ancestors.map((id) => tasks.hasWork(id));
      const removedWork = tasks.removeSession(
        sessionID,
        new Error(`OpenCode removed conversation '${sessionID}'.`),
      );
      interruptions.delete(sessionID);
      return () => {
        if (removedWork) reportBackground(ancestors, before, timestamp);
      };
    },
    /** Starts to follow the end event of the current execution of the session. */
    watchExecutionEnd: (sessionID: string): OpenCodeExecutionEndWatch =>
      tasks.watchExecutionEnd(sessionID),
    /**
     * Waits for the end event of the execution that an interrupt stopped. OpenCode publishes that
     * event after every event of the execution, so the tasks that the reply started are then
     * known. An interrupt that stopped no execution needs no wait.
     */
    waitForInterruptedExecution: async (
      ref: SessionRef,
      end: OpenCodeExecutionEndWatch,
      interrupted: boolean,
    ): Promise<void> => {
      try {
        if (interrupted) await observeCleanup(ref, end.ended);
      } finally {
        end.stop();
      }
    },
    /**
     * Interrupts the root of the session tree and stops its background work in the rounds of
     * `stopBackgroundWork`. A session that takes a notice starts a reply, so the watch, which
     * starts before the root interrupt, interrupts that reply too. An undelivered notice wakes its
     * session, so the stop cancels it and queues the same result again with no wake: OpenCode
     * delivers it with the next input of the session, and the call card keeps its result.
     */
    stopTree: async (ref: SessionRef, interruptRoot: () => Promise<void>): Promise<void> => {
      const pendingInterrupts: Promise<void>[] = [];
      const unwatch = tasks.watch(ref.externalSessionId, (sessionID) => {
        // The reply that took the result ends with an end event after all of its events, also
        // when it ends by itself before the interrupt.
        const end = tasks.watchExecutionEnd(sessionID);
        const interrupt = nativeRequest(
          ref,
          "interrupt a conversation woken by a task result",
          () => client.session.interrupt({ sessionID }),
        )
          .then(() => observeCleanup(ref, end.ended))
          .finally(end.stop);
        // The stop awaits each interrupt. This handler only keeps a rejection handled until then.
        interrupt.catch(() => undefined);
        pendingInterrupts.push(interrupt);
      });
      try {
        await interruptRoot();
        await stopBackgroundWork(tasks, ref.externalSessionId, {
          inEventOrder: async (read) => {
            // The watch can add an interrupt while an earlier one is awaited.
            for (let index = 0; index < pendingInterrupts.length; index += 1)
              await pendingInterrupts[index];
            return read();
          },
          stop: (entries) => async () => {
            await Promise.all(entries.map((entry) => stopNativeTask(ref, entry)));
            await observeCleanup(ref, Promise.all(entries.map((entry) => tasks.waitForEnd(entry))));
          },
          // OpenCode answers the cancellation of a notice that a session took with success, so
          // the wait for the delivery or cancellation event tells whether a session woke.
          settle: async (notices) => {
            await Promise.all(
              notices.map(async ({ key: inboxID, sessionID }) => {
                const notice = tasks.resultNotice(inboxID);
                if (!notice)
                  throw operationError(
                    ref,
                    "stop the background tasks",
                    "runtime_unavailable",
                    `The notice of the task result '${inboxID}' is unknown.`,
                  );
                tasks.recordSettle(inboxID);
                let delivered: boolean | undefined;
                try {
                  await nativeRequest(ref, "cancel a task result", () =>
                    client.session.inbox.cancel({ sessionID, inboxID }),
                  );
                  await observeCleanup(ref, tasks.waitForSettle(inboxID));
                } finally {
                  delivered = tasks.takeSettle(inboxID);
                }
                // The session took the notice, so the watch interrupts its reply.
                if (delivered !== false) return;
                // `resume: false` admits the result without a wake (`Session.synthetic`).
                const id = createOpenCodeMessageId();
                tasks.parkResult(sessionID, id);
                await nativeRequest(ref, "keep a task result", () =>
                  client.session.synthetic({
                    sessionID,
                    id,
                    ...notice.payload,
                    metadata: keptResultMetadata(notice.payload.metadata, notice.time.created),
                    delivery: notice.delivery,
                    resume: false,
                  }),
                );
              }),
            );
          },
          tooMany: (entries) =>
            operationError(
              ref,
              "stop the background tasks",
              "request_failed",
              `The conversation started background tasks again after ${BACKGROUND_STOP_ROUNDS} stop rounds: ${entries.map((entry) => entry.task.title).join(", ")}.`,
              "Stop the listed tasks one by one, then stop the session again.",
            ),
          lost: (lost) =>
            operationError(ref, "stop the background tasks", "runtime_unavailable", lost.message),
        });
      } finally {
        unwatch();
      }
    },
    /** Stops one task of the session tree. A task that is not running needs no stop. */
    stopTask: async (ref: SessionRef, taskId: string): Promise<void> => {
      // After a tracking loss the adapter cannot tell whether the task still runs.
      const lost = tasks.lostIn(ref.externalSessionId);
      if (lost)
        throw operationError(ref, "stop a background task", "runtime_unavailable", lost.message);
      const entry = tasks.find(ref.externalSessionId, taskId);
      if (!entry) return;
      // A task whose notice confirmed its end during the request needs no stop.
      await tasks.stopTask(entry, () => stopNativeTask(ref, entry));
    },
    /**
     * Stops following the released sessions. `observed` are their ancestors that stay observed,
     * nearest first. The nearest one takes the loss of the unresolved work of the released tree.
     */
    release: (released: readonly string[], observed: readonly string[]): void => {
      const lost = tasks.releaseSessions(released, observed[0]);
      for (const sessionID of released) interruptions.delete(sessionID);
      if (!lost) return;
      // Report the loss first, so no ancestor snapshot shows Idle while the work is unknown.
      emit({
        type: "session_fault",
        externalSessionId: observed[0]!,
        message: lost.message,
        statusUnavailable: true,
        backgroundTrackingLost: true,
      });
      for (const sessionID of observed) reportWork(sessionID);
    },
    /** Fails every wait, now and later, because no event can arrive any more. */
    close: (cause: Error): void => tasks.close(cause),
  };
};
