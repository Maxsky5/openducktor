import type { SessionInboxInfo, SessionMessageAssistantTool } from "@opencode/client";
import type { AgentSessionBackgroundTask } from "@openducktor/contracts";
import {
  type AgentSessionBackgroundWork,
  BackgroundWaiters,
  BackgroundWorkLedger,
} from "@openducktor/core";
import { z } from "zod";

/** The native handle that stops one background task. */
type OpenCodeBackgroundTarget =
  | { readonly kind: "shell"; readonly shellID: string; readonly directory: string }
  | { readonly kind: "subagent"; readonly childID: string };

export type OpenCodeBackgroundEntry = {
  /**
   * The native job of the task. A continued subagent runs again under the same key, so the
   * `taskId` of the task names the run, and the key names the job.
   */
  readonly key: string;
  readonly task: AgentSessionBackgroundTask;
  readonly target: OpenCodeBackgroundTarget;
  /** The session that owns the tool call. Its inbox receives the end notice. */
  readonly sessionID: string;
};

/** A watch for the next execution end of a session. `stop` ends the watch. */
export type OpenCodeExecutionEndWatch = {
  readonly ended: Promise<void>;
  readonly stop: () => void;
};

// Mirrors the tool results of `packages/core/src/tool/plugin/shell.ts` and `subagent.ts` of
// OpenCode 2.2.5. A background call completes with `status: "running"`.
const shellInputSchema = z.object({ command: z.string().trim().min(1) });
const shellMetadataSchema = z.object({ shellID: z.string().min(1) });
const subagentInputSchema = z.object({
  agent: z.string().trim().min(1),
  description: z.string().optional(),
});
const subagentMetadataSchema = z.object({ sessionID: z.string().min(1) });

// Mirrors `ShellResult.notification` and `SubagentCompletion.deliver` of OpenCode 2.2.5.
const noticeState = z.enum(["completed", "cancelled", "error"]);
const shellNoticeSchema = z.object({
  source: z.literal("shell"),
  // A user shell that fails to start sends a notice with no shell ID.
  shellID: z.string().min(1).optional(),
  state: noticeState,
});
const subagentNoticeSchema = z.object({
  source: z.literal("subagent"),
  childID: z.string().min(1),
  state: noticeState,
});

// OpenCode gives each shell a new ascending ID (`Shell.ID.ascending` in `packages/core/src/shell.ts`).
const shellKey = (shellID: string) => `shell:${shellID}`;
// A continued subagent runs its child session again, so its tool call names the run.
const subagentKey = (childID: string) => `subagent:${childID}`;

const malformed = (what: string, error: z.ZodError): Error =>
  new Error(
    `OpenCode sent an invalid ${what}: ${z.prettifyError(error)} Check the OpenCode version, then restart the runtime.`,
  );

/** The session and its ancestors, from the session up. */
const sessionChain = (
  parentOf: (sessionID: string) => string | undefined,
  sessionID: string,
): string[] => {
  const chain = [sessionID];
  let parent = parentOf(sessionID);
  while (parent !== undefined && !chain.includes(parent)) {
    chain.push(parent);
    parent = parentOf(parent);
  }
  return chain;
};

/** Tells if `sessionID` is `rootID` or one of its descendants. Stops at a cycle, as `sessionChain`. */
const isInTree = (
  parentOf: (sessionID: string) => string | undefined,
  sessionID: string,
  rootID: string,
): boolean => {
  const seen = new Set<string>();
  let current: string | undefined = sessionID;
  while (current !== undefined && !seen.has(current)) {
    if (current === rootID) return true;
    seen.add(current);
    current = parentOf(current);
  }
  return false;
};

/** Reads the task of a completed background tool call of a known source. */
const readEntry = (
  sessionID: string,
  directory: string,
  part: SessionMessageAssistantTool,
): OpenCodeBackgroundEntry | undefined => {
  if (part.state.status !== "completed" || part.state.metadata?.status !== "running")
    return undefined;
  if (part.name === "shell") {
    const input = shellInputSchema.safeParse(part.state.input);
    if (!input.success) throw malformed("background shell call", input.error);
    const metadata = shellMetadataSchema.safeParse(part.state.metadata);
    if (!metadata.success) throw malformed("background shell result", metadata.error);
    const { shellID } = metadata.data;
    return {
      key: shellKey(shellID),
      task: {
        taskId: shellKey(shellID),
        kind: "command",
        title: input.data.command,
        stop: { allowed: true },
      },
      target: { kind: "shell", shellID, directory },
      sessionID,
    };
  }
  if (part.name !== "subagent") return undefined;
  const input = subagentInputSchema.safeParse(part.state.input);
  if (!input.success) throw malformed("background subagent call", input.error);
  const metadata = subagentMetadataSchema.safeParse(part.state.metadata);
  if (!metadata.success) throw malformed("background subagent result", metadata.error);
  const key = subagentKey(metadata.data.sessionID);
  const task: AgentSessionBackgroundTask = {
    taskId: `${key}:${part.id}`,
    kind: "subagent",
    title: input.data.agent,
    stop: { allowed: true },
  };
  const description = input.data.description?.trim();
  if (description) task.description = description;
  return { key, task, target: { kind: "subagent", childID: metadata.data.sessionID }, sessionID };
};

/** Reads the task key of an inbox notice of a known source. */
const readNoticeKey = (item: SessionInboxInfo): string | undefined => {
  if (item.type !== "synthetic") return undefined;
  const source = item.payload.metadata?.source;
  if (source === "shell") {
    const notice = shellNoticeSchema.safeParse(item.payload.metadata);
    if (!notice.success) throw malformed("shell notice", notice.error);
    return notice.data.shellID === undefined ? undefined : shellKey(notice.data.shellID);
  }
  if (source !== "subagent") return undefined;
  const notice = subagentNoticeSchema.safeParse(item.payload.metadata);
  if (!notice.success) throw malformed("subagent notice", notice.error);
  return subagentKey(notice.data.childID);
};

/**
 * The background tasks that the event stream showed live. A task starts when its tool call
 * completes with `status: "running"`, and ends only on its notice in the session inbox. The
 * notice stays a pending result until the inbox delivers or cancels it. A fast task can send its
 * notice before its start, so a notice of an unknown task waits for that start.
 */
export class OpenCodeBackgroundTasks extends BackgroundWorkLedger<OpenCodeBackgroundEntry> {
  /**
   * Notices of tasks that did not start yet, per session: the task key and the inbox ID while the
   * notice is undelivered. A late start of such a task adds no task, but makes its undelivered
   * notice a pending result. A notice of a task of an earlier runtime process never gets a start.
   */
  private readonly early = new Map<string, Map<string, string | undefined>>();
  private readonly watches = new Set<[string, (sessionID: string) => void]>();
  /** The sessions that took a task notice in an execution that did not end yet. */
  private readonly woken = new Set<string>();
  /** Waits for the end of an execution, per session. */
  private readonly executionWaiters = new BackgroundWaiters();

  constructor(private readonly parentOf: (sessionID: string) => string | undefined) {
    super((rootID) => ({
      has: (sessionID) => isInTree(parentOf, sessionID, rootID),
    }));
  }

  /** Starts the task of a completed background tool call. Returns false when nothing changed. */
  startCall(sessionID: string, directory: string, part: SessionMessageAssistantTool): boolean {
    const entry = readEntry(sessionID, directory, part);
    // A subagent call on a running child joins its job, so the run keeps its task.
    if (!entry || this.get(entry.key)) return false;
    // A continued subagent starts again after its notice was handled, so it runs again.
    const early = this.early.get(sessionID);
    if (!early?.has(entry.key)) {
      this.start(entry);
      return true;
    }
    const inboxID = early.get(entry.key);
    early.delete(entry.key);
    if (inboxID === undefined) return false;
    this.addResult(inboxID, sessionID);
    return true;
  }

  /** Ends the task of a notice in the inbox of its owner. Returns false when nothing changed. */
  notice(sessionID: string, item: SessionInboxInfo): boolean {
    const key = readNoticeKey(item);
    if (key === undefined) return false;
    const entry = this.get(key);
    if (entry?.sessionID !== sessionID) {
      if (!entry) {
        const early = this.early.get(sessionID) ?? new Map<string, string | undefined>();
        early.set(key, item.id);
        this.early.set(sessionID, early);
      }
      return false;
    }
    this.end(key);
    this.addResult(item.id, sessionID);
    return true;
  }

  /**
   * Calls `onWake` with each session of the tree of `rootID` that takes a task notice, until the
   * returned function ends the watch. The watch first calls `onWake` with each session of the tree
   * that took a task notice in an execution that did not end yet. OpenCode delivers a notice
   * inside the execution that it starts or steers, so that execution runs when `onWake` is called.
   */
  watch(rootID: string, onWake: (sessionID: string) => void): () => void {
    const watch: [string, (sessionID: string) => void] = [rootID, onWake];
    this.watches.add(watch);
    for (const sessionID of this.woken) if (this.inTree(sessionID, rootID)) onWake(sessionID);
    return () => this.watches.delete(watch);
  }

  /** Clears the pending result of a delivered or cancelled notice in the inbox of its owner. */
  settle(sessionID: string, inboxID: string, delivered: boolean): boolean {
    let notice = this.resultOwner(inboxID) === sessionID;
    const early = this.early.get(sessionID);
    if (early)
      for (const [key, id] of early)
        if (id === inboxID) {
          early.set(key, undefined);
          notice = true;
        }
    if (notice && delivered) {
      this.woken.add(sessionID);
      for (const [rootID, onWake] of this.watches)
        if (this.inTree(sessionID, rootID)) onWake(sessionID);
    }
    return this.settleResult(inboxID);
  }

  /**
   * Marks the tracking of the session tree as lost, because the adapter could not read one of its
   * task items, or because it released a descendant that still ran tasks. Each pending wait of the
   * session fails with the reason, also the wait for the end of its execution.
   */
  override lose(sessionID: string, cause: Error): void {
    super.lose(sessionID, cause);
    this.executionWaiters.reject(sessionID, cause);
  }

  /**
   * Watches for the next execution end of the session. Start the watch before the interrupt
   * request, because the end event can arrive before the answer. The end of the event stream, a
   * release, and the removal of the session fail the wait.
   */
  watchExecutionEnd(sessionID: string): OpenCodeExecutionEndWatch {
    let stop: () => void = () => undefined;
    const ended = new Promise<void>((resolve, reject) => {
      if (this.closed) reject(this.closed);
      else stop = this.executionWaiters.add(sessionID, { resolve, reject });
    });
    // The caller awaits the end only when the interrupt stopped an execution.
    ended.catch(() => undefined);
    return { ended, stop };
  }

  /** Resolves the watches of the session at the end event of its execution. */
  executionEnded(sessionID: string): void {
    this.woken.delete(sessionID);
    this.executionWaiters.resolve(sessionID);
  }

  /** The session and its ancestors, from the session up. */
  chain(sessionID: string): string[] {
    return sessionChain(this.parentOf, sessionID);
  }

  /** The run of `taskId` in the session tree of `rootID`. A run that ended is not found. */
  find(rootID: string, taskId: string): OpenCodeBackgroundEntry | undefined {
    return this.tasksIn(rootID).find((entry) => entry.task.taskId === taskId);
  }

  work(rootID: string): AgentSessionBackgroundWork {
    return {
      tasks: this.tasksIn(rootID).map((entry) => entry.task),
      resultPending: this.resultsIn(rootID).length > 0,
    };
  }

  /**
   * Drops the tasks and notices of a removed or released session. A pending wait for the end of
   * its execution fails. A wait for one of its tasks or notices fails, also when it starts later.
   */
  override removeSession(sessionID: string, cause: Error): boolean {
    const changed = super.removeSession(sessionID, cause);
    this.early.delete(sessionID);
    this.woken.delete(sessionID);
    this.executionWaiters.reject(sessionID, cause);
    return changed;
  }

  /**
   * Drops the tasks and notices of the released sessions. When they leave unresolved work,
   * `ancestorID`, the nearest ancestor that stays observed, loses the tracking of its tree.
   * Returns the reason of that loss.
   */
  releaseSessions(
    sessionIDs: readonly string[],
    ancestorID: string | undefined,
  ): Error | undefined {
    const cause = this.release(sessionIDs, ancestorID, {
      dropped: (sessionID) => new Error(`The conversation '${sessionID}' was released.`),
      unresolved: (entries, undelivered) => {
        const unresolved: string[] = [];
        if (entries.length > 0)
          unresolved.push(
            `these background tasks still ran: ${entries.map((entry) => `'${entry.task.title}'`).join(", ")}`,
          );
        if (undelivered > 0)
          unresolved.push(
            `${undelivered} background task ${undelivered === 1 ? "result was" : "results were"} not delivered`,
          );
        return new Error(
          `The conversation '${sessionIDs[0]}' was released while ${unresolved.join(" and ")}. OpenDucktor cannot confirm that they ended, so the status of the parent conversations is unavailable. Check the tasks, then restart the runtime.`,
        );
      },
    });
    // The pending waits of the ancestor fail too, as after an unreadable task item.
    if (cause) this.lose(ancestorID!, cause);
    return cause;
  }

  /** Fails every wait, now and later, because no event can arrive any more. */
  override close(cause: Error): void {
    super.close(cause);
    this.executionWaiters.rejectAll(cause);
  }
}
