/** A wait for the end of a task, for the settle of a result, or for another runtime event. */
export type BackgroundWaiter = {
  readonly resolve: () => void;
  readonly reject: (cause: Error) => void;
};

/** A background task. `key` names its native job, and `sessionID` names the session that owns it. */
export type BackgroundWorkTask = { readonly key: string; readonly sessionID: string };

/** An undelivered task result. `key` names its native item, and `sessionID` names its owner. */
export type BackgroundWorkResult = { readonly key: string; readonly sessionID: string };

/** The sessions of one session tree: the root and its descendants. */
export type BackgroundSessionTree = { readonly has: (sessionID: string) => boolean };

/** The causes that a release of sessions gives. */
export type BackgroundWorkRelease<Task> = {
  /** The cause that fails each wait for the work of the released session. */
  readonly dropped: (sessionID: string) => Error;
  /** The new loss reason for the tasks and the results that the released sessions left. */
  readonly unresolved: (tasks: readonly Task[], results: number) => Error;
};

/** The waits per key. Each wait resolves or fails one time. */
export class BackgroundWaiters {
  private readonly byKey = new Map<string, Set<BackgroundWaiter>>();

  /** Adds the wait. The returned function removes it. */
  add(key: string, waiter: BackgroundWaiter): () => void {
    const waiters = this.byKey.get(key) ?? new Set<BackgroundWaiter>();
    this.byKey.set(key, waiters);
    waiters.add(waiter);
    return () => {
      waiters.delete(waiter);
      if (waiters.size === 0 && this.byKey.get(key) === waiters) this.byKey.delete(key);
    };
  }

  wait(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.add(key, { resolve, reject });
    });
  }

  resolve(key: string): void {
    for (const waiter of this.take(key)) waiter.resolve();
  }

  reject(key: string, cause: Error): void {
    for (const waiter of this.take(key)) waiter.reject(cause);
  }

  rejectAll(cause: Error): void {
    for (const key of this.byKey.keys()) this.reject(key, cause);
  }

  private take(key: string): Iterable<BackgroundWaiter> {
    const waiters = this.byKey.get(key);
    if (!waiters) return [];
    this.byKey.delete(key);
    return waiters;
  }
}

/**
 * The background work that an adapter observed live: the running tasks and the undelivered task
 * results of each session. The adapter reads a session tree through `treeOf`. A wait for the end
 * of a task or for the settle of a result resolves only on that event. It fails when the adapter
 * cannot observe that event any more: after a tracking loss of the owner, after the release of the
 * owner, or after the end of the runtime events.
 */
export class BackgroundWorkLedger<Task extends BackgroundWorkTask> {
  /** The running tasks by key, oldest first. */
  private readonly tasks = new Map<string, Task>();
  /** The owner of each undelivered result, by result key. */
  private readonly results = new Map<string, string>();
  private readonly endWaiters = new BackgroundWaiters();
  private readonly settleWaiters = new BackgroundWaiters();
  /**
   * The reason per session that cannot confirm the end of the work of its tree any more. It stays
   * until the release of the session or of the runtime.
   */
  private readonly lost = new Map<string, Error>();
  /** The reason per task and per result that left the ledger with its session before its end. */
  private readonly dropped = new WeakMap<Task, Error>();
  private readonly droppedResults = new Map<string, Error>();
  private closure: Error | undefined;

  constructor(private readonly treeOf: (rootID: string) => BackgroundSessionTree) {}

  /** The reason of the end of the runtime events. No wait can resolve after it. */
  get closed(): Error | undefined {
    return this.closure;
  }

  start(task: Task): void {
    this.tasks.set(task.key, task);
  }

  get(key: string): Task | undefined {
    return this.tasks.get(key);
  }

  /** Ends the running task of the key on its end event. Returns the task, if it ran. */
  end(key: string): Task | undefined {
    const task = this.tasks.get(key);
    if (!task) return undefined;
    this.tasks.delete(key);
    this.endWaiters.resolve(key);
    return task;
  }

  /** Adds the undelivered result of an ended task. */
  addResult(key: string, sessionID: string): void {
    this.results.set(key, sessionID);
    this.droppedResults.delete(key);
  }

  resultOwner(key: string): string | undefined {
    return this.results.get(key);
  }

  /** Clears the result on its delivery or cancellation. Returns false when nothing changed. */
  settleResult(key: string): boolean {
    this.droppedResults.delete(key);
    const changed = this.results.delete(key);
    this.settleWaiters.resolve(key);
    return changed;
  }

  /** The running tasks that the session owns, oldest first. */
  tasksOf(sessionID: string): Task[] {
    if (this.tasks.size === 0) return [];
    return [...this.tasks.values()].filter((task) => task.sessionID === sessionID);
  }

  /** Tells if the ledger tracks no task and no result. */
  get isEmpty(): boolean {
    return this.tasks.size === 0 && this.results.size === 0;
  }

  /** Tells if a running task matches, without a walk of a session tree. */
  protected someTask(matches: (task: Task) => boolean): boolean {
    for (const task of this.tasks.values()) if (matches(task)) return true;
    return false;
  }

  /** The running tasks of the session tree of `rootID`, oldest first. */
  tasksIn(rootID: string): Task[] {
    if (this.tasks.size === 0) return [];
    const tree = this.treeOf(rootID);
    return [...this.tasks.values()].filter((task) => tree.has(task.sessionID));
  }

  /** The undelivered results of the session tree of `rootID`. */
  resultsIn(rootID: string): BackgroundWorkResult[] {
    if (this.results.size === 0) return [];
    const tree = this.treeOf(rootID);
    return [...this.results]
      .filter(([, sessionID]) => tree.has(sessionID))
      .map(([key, sessionID]) => ({ key, sessionID }));
  }

  /** Tells if the session tree of `rootID` has a running task or an undelivered result. */
  hasWork(rootID: string): boolean {
    if (this.tasks.size === 0 && this.results.size === 0) return false;
    const tree = this.treeOf(rootID);
    for (const task of this.tasks.values()) if (tree.has(task.sessionID)) return true;
    for (const sessionID of this.results.values()) if (tree.has(sessionID)) return true;
    return false;
  }

  /** The tracking loss that the session holds, if any. */
  lossOf(sessionID: string): Error | undefined {
    return this.lost.get(sessionID);
  }

  /** Tells if the session is in the session tree of `rootID`. */
  protected inTree(sessionID: string, rootID: string): boolean {
    return this.treeOf(rootID).has(sessionID);
  }

  /** The first tracking loss in the session tree of `rootID`, if any. */
  lostIn(rootID: string): Error | undefined {
    if (this.lost.size === 0) return undefined;
    const tree = this.treeOf(rootID);
    for (const [sessionID, cause] of this.lost) if (tree.has(sessionID)) return cause;
    return undefined;
  }

  /** Tells if the end event of the task arrived. A dropped task has no confirmed end. */
  ended(task: Task): boolean {
    return this.tasks.get(task.key) !== task && !this.dropped.has(task);
  }

  /**
   * Calls `waiter` at the end event of the task, or at once when it arrived. Fails when the end
   * cannot be confirmed. The returned function ends the wait.
   */
  watchEnd(task: Task, waiter: BackgroundWaiter): () => void {
    const failure = this.closure ?? this.dropped.get(task) ?? this.lostOwner(task);
    if (failure) waiter.reject(failure);
    else if (this.tasks.get(task.key) !== task) waiter.resolve();
    else return this.endWaiters.add(task.key, waiter);
    return () => undefined;
  }

  /** Resolves at the end event of the task. Fails on the same conditions as `watchEnd`. */
  waitForEnd(task: Task): Promise<void> {
    return new Promise((resolve, reject) => {
      this.watchEnd(task, { resolve, reject });
    });
  }

  /** Resolves when the result is delivered or cancelled, or at once when it is settled. */
  waitForSettle(key: string): Promise<void> {
    const failure = this.closure ?? this.droppedResults.get(key);
    if (failure) return Promise.reject(failure);
    const owner = this.results.get(key);
    if (owner === undefined) return Promise.resolve();
    const lost = this.lost.get(owner);
    if (lost) return Promise.reject(lost);
    return this.settleWaiters.wait(key);
  }

  /**
   * Runs the native request that stops one task. A failure of the request counts, unless the end
   * event of the task confirmed its end during the request.
   */
  async stopTask(task: Task, request: () => Promise<void>): Promise<void> {
    try {
      await request();
    } catch (cause) {
      if (!this.ended(task)) throw cause;
    }
  }

  /**
   * Marks the tracking of the session as lost. Each pending wait for its tasks and results fails
   * with the reason, and so does each later wait. Its tasks stay in the list.
   */
  lose(sessionID: string, cause: Error): void {
    this.lost.set(sessionID, cause);
    for (const task of this.tasksOf(sessionID)) this.endWaiters.reject(task.key, cause);
    for (const [key, owner] of this.results)
      if (owner === sessionID) this.settleWaiters.reject(key, cause);
  }

  /**
   * Drops the tasks, the results, and the loss of a removed or released session. Each wait for
   * one of its tasks or results fails, also when it starts later. Returns false when no task and
   * no result changed.
   */
  removeSession(sessionID: string, cause: Error): boolean {
    let changed = false;
    for (const task of this.tasksOf(sessionID)) {
      this.tasks.delete(task.key);
      this.dropped.set(task, cause);
      this.endWaiters.reject(task.key, cause);
      changed = true;
    }
    for (const [key, owner] of this.results)
      if (owner === sessionID) {
        this.results.delete(key);
        this.droppedResults.set(key, cause);
        this.settleWaiters.reject(key, cause);
        changed = true;
      }
    this.lost.delete(sessionID);
    return changed;
  }

  /**
   * Drops the released sessions. Their unresolved work is each running task, each undelivered
   * result, and each loss that they hold. When that work is not empty, `ancestorID`, the nearest
   * ancestor that stays observed, records the loss with the new reason, its earlier reason, and
   * the reasons of the released sessions. The waits of the ancestor continue, because its own
   * events still arrive. An adapter whose ancestor waits cannot end after the loss fails them with
   * `lose`. Returns the loss.
   */
  release(
    sessionIDs: readonly string[],
    ancestorID: string | undefined,
    causes: BackgroundWorkRelease<Task>,
  ): Error | undefined {
    const released = new Set(sessionIDs);
    const tasks = [...this.tasks.values()].filter((task) => released.has(task.sessionID));
    const results = [...this.results.values()].filter((owner) => released.has(owner)).length;
    const reasons = sessionIDs.flatMap((sessionID) => this.lost.get(sessionID) ?? []);
    for (const sessionID of sessionIDs) this.removeSession(sessionID, causes.dropped(sessionID));
    if (ancestorID === undefined) return undefined;
    if (tasks.length > 0 || results > 0) reasons.unshift(causes.unresolved(tasks, results));
    if (reasons.length === 0) return undefined;
    const earlier = this.lost.get(ancestorID);
    if (earlier) reasons.unshift(earlier);
    const messages = [...new Set(reasons.map((reason) => reason.message))];
    const cause = messages.length === 1 ? reasons[0]! : new Error(messages.join(" "));
    this.lost.set(ancestorID, cause);
    return cause;
  }

  /** Fails every wait, now and later, because no runtime event can arrive any more. */
  close(cause: Error): void {
    this.closure ??= cause;
    this.endWaiters.rejectAll(cause);
    this.settleWaiters.rejectAll(cause);
  }

  private lostOwner(task: Task): Error | undefined {
    return this.tasks.get(task.key) === task ? this.lost.get(task.sessionID) : undefined;
  }
}

/** The stop rounds of Stop session. A tree that still starts tasks after them fails the stop. */
export const BACKGROUND_STOP_ROUNDS = 3;

/** The native steps of Stop session for the background work of one session tree. */
export type BackgroundWorkStop<Task> = {
  /** Runs `read` after the runtime events that the adapter already received. */
  readonly inEventOrder: <T>(read: () => T) => Promise<T>;
  /**
   * Starts the stop of the tasks in the read step. Returns the rest of the stop, which sends the
   * native requests and waits for the confirmed end of each task.
   */
  readonly stop: (tasks: readonly Task[]) => () => Promise<void>;
  /** Cancels the undelivered results and waits for their settle. Omit it without results. */
  readonly settle?: (results: readonly BackgroundWorkResult[]) => Promise<void>;
  /** The failure for the tasks that still run after the last round. */
  readonly tooMany: (tasks: readonly Task[]) => Error;
  /** The failure for a tracking loss of the tree. Without it, the stop fails with the loss. */
  readonly lost?: (cause: Error) => Error;
  /** Runs in the read step that finds no work in the tree. */
  readonly idle?: () => void;
};

type BackgroundStopStep =
  | { readonly run: () => Promise<void> }
  | { readonly results: readonly BackgroundWorkResult[] }
  | undefined;

/**
 * Stops the background work of the session tree of `rootID`. Each round reads the tree. A tree
 * that lost its tracking fails at once, because the stop cannot confirm that its work ended.
 * Running tasks are stopped and their confirmed ends awaited, for at most
 * `BACKGROUND_STOP_ROUNDS` rounds. Without tasks, undelivered results are settled. A tree without
 * work succeeds.
 */
export const stopBackgroundWork = async <Task extends BackgroundWorkTask>(
  ledger: BackgroundWorkLedger<Task>,
  rootID: string,
  steps: BackgroundWorkStop<Task>,
): Promise<void> => {
  const read = (round: number): BackgroundStopStep => {
    // A lost tree cannot confirm the end of its work, so a stop fails before any native request.
    const lost = ledger.lostIn(rootID);
    if (lost) throw steps.lost ? steps.lost(lost) : lost;
    const tasks = ledger.tasksIn(rootID);
    if (tasks.length > 0) {
      if (round === BACKGROUND_STOP_ROUNDS) throw steps.tooMany(tasks);
      return { run: steps.stop(tasks) };
    }
    const results = steps.settle ? ledger.resultsIn(rootID) : [];
    if (results.length > 0) return { results };
    steps.idle?.();
    return undefined;
  };
  for (let round = 0; ;) {
    const step = await steps.inEventOrder(() => read(round));
    if (!step) return;
    if ("run" in step) {
      round += 1;
      await step.run();
    } else await steps.settle?.(step.results);
  }
};
