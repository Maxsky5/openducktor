import { CancelledError } from "@tanstack/react-query";
import { isConnectionFailure } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import type { GitDiffRefreshMode } from "../contracts";
import type { GitPanelReads } from "../reads/use-git-panel-reads";
import { startEarlyRead } from "./early-read";

export const SCHEDULED_FETCH_COOLDOWN_MS = 5 * 60 * 1000;

/** The remote fetch and target check of one comparison. */
export type GitRefreshComparison = {
  /** Fetches with one key share one run and one cooldown. */
  fetchKey: string;
  fetch: () => Promise<void>;
  /** Checks the target again. True means the target changed, so its new reads start by themselves. */
  check: () => Promise<boolean>;
};

/** The steps of one render. Each step uses the query keys of that render. */
/** The reads come from the panel reads of the same render. */
export type GitRefreshSteps = Pick<
  GitPanelReads,
  "readLocal" | "readComparison" | "readInBackground" | "markStale"
> & {
  /** Reads the checkout again and returns its key. */
  readBranch: () => Promise<string>;
  /** Null when no comparison target is known. */
  comparison: GitRefreshComparison | null;
};

/** The Git context that one render shows. */
export type GitRefreshView = {
  /** The session, directory, and target choice. */
  scopeKey: string;
  /** The checkout. A refresh that reads another checkout follows it. */
  branchKey: string;
  visible: boolean;
  /** True when the checkout is known, so Git reads can start. */
  ready: boolean;
  /**
   * Reads the settings or worktree that failed to load. A manual Refresh runs it first, and then
   * continues in the next render of its context. Null when nothing failed.
   */
  prepare: (() => Promise<void>) | null;
  steps: GitRefreshSteps;
  /** Adds the file reads of the view. A refresh can give its own. */
  withFiles?: GitFileRefresh;
};

/** Runs the Git reads together with the file reads of the same directory. */
export type GitFileRefresh = (
  mode: GitDiffRefreshMode,
  readGit: () => Promise<void>,
) => Promise<void>;

export type ManualRefreshState = { isRefreshing: boolean; error: string | null };

type GitRefreshDeps = {
  now: () => number;
  /**
   * Reports a failed branch, settings, fetch, or target check. Each view shows its own failed read.
   * A lost host connection is not reported: the connection state shows it, and the reconnect reads
   * the shown context again.
   */
  onFailedCheck: (message: string) => void;
};

type ManualRun = { key: string; promise: Promise<void> | null; state: ManualRefreshState };
/** A manual run has no visit, so a return to its context continues it. */
type RefreshRun = { manual: ManualRun | null; visit: number | null };
type WaitDecision = "use" | "wait" | "end";

const IDLE: ManualRefreshState = { isRefreshing: false, error: null };
const readGitOnly: GitFileRefresh = (_mode, readGit) => readGit();
const readNothing = (): Promise<void> => Promise.resolve();

export const manualRefreshKey = (view: Pick<GitRefreshView, "scopeKey" | "branchKey">): string =>
  JSON.stringify([view.scopeKey, view.branchKey]);

/**
 * Runs the refreshes of one Git panel. The panel publishes its view after each render. A refresh
 * runs its steps in order: settings, branch, fetch and target check, then reads. A step that needs
 * the next render, such as a found branch, waits for a view of its own context. A manual Refresh
 * keeps its pending state and failure on its own context, so another context never shows them.
 */
export class GitRefreshCoordinator {
  readonly #deps: GitRefreshDeps;
  #view: GitRefreshView | null = null;
  /** Counts the times that the view left its context. A branch change stays in the visit. */
  #visit = 0;
  readonly #waiters = new Set<(view: GitRefreshView | null) => void>();
  readonly #listeners = new Set<() => void>();
  readonly #manualRuns = new Map<string, ManualRun>();
  readonly #fetches = new Map<string, Promise<void>>();
  readonly #fetchedAt = new Map<string, number>();

  constructor(deps: GitRefreshDeps) {
    this.#deps = deps;
  }

  /** Gives the view of the last render. Null ends every waiting step. */
  publish(view: GitRefreshView | null): void {
    const previous = this.#view;
    if (!view?.visible || !previous?.visible || view.scopeKey !== previous.scopeKey) {
      this.#visit += 1;
    }
    this.#view = view;
    for (const waiter of this.#waiters) waiter(view);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  manualState(key: string): ManualRefreshState {
    return this.#manualRuns.get(key)?.state ?? IDLE;
  }

  /**
   * Refreshes the shown view. `hard` is the manual Refresh: it joins a running Refresh of the same
   * context and never rejects, because its state shows the failure. `soft` and `scheduled` reject
   * when a read fails.
   */
  refresh(mode: GitDiffRefreshMode, files?: GitFileRefresh): Promise<void> {
    const view = this.#view;
    const withFiles = files ?? view?.withFiles ?? readGitOnly;
    // File views read again even when the Git view cannot.
    if (!view) return withFiles(mode, readNothing);
    // A hidden or unready view reads when it shows, because its reads are marked stale.
    if (!view.visible) return withFiles(mode, () => view.steps.markStale());
    if (mode === "hard") return this.#startManual(view, withFiles);
    if (!view.ready) return withFiles(mode, () => view.steps.markStale());
    // Another context ends this refresh, and the reads of this context become stale.
    const visit = this.#visit;
    return withFiles(mode, () => this.#refreshCheckout(view, mode, { manual: null, visit }));
  }

  #startManual(view: GitRefreshView, withFiles: GitFileRefresh): Promise<void> {
    const key = manualRefreshKey(view);
    const running = this.#manualRuns.get(key);
    if (running?.promise) return running.promise;
    const run: ManualRun = { key, promise: null, state: { isRefreshing: true, error: null } };
    this.#manualRuns.set(key, run);
    this.#notify();
    run.promise = this.#settleManual(
      run,
      withFiles("hard", () => this.#runManual(view, run)),
    );
    return run.promise;
  }

  /** Keeps the outcome in the Refresh state, so the caller gets no rejection. */
  async #settleManual(run: ManualRun, refresh: Promise<void>): Promise<void> {
    let error: string | null = null;
    try {
      await refresh;
    } catch (cause) {
      error = errorMessage(cause);
    }
    run.promise = null;
    run.state = { isRefreshing: false, error };
    this.#notify();
  }

  async #runManual(view: GitRefreshView, run: ManualRun): Promise<void> {
    let current: GitRefreshView | null = view;
    // A Refresh that another context ends leaves the reads of its own context stale.
    if (current.prepare) {
      current = await this.#prepare(current, current.prepare, run);
      if (!current) return view.steps.markStale();
    }
    if (!current.ready) {
      current = await this.#waitFor((next) => this.#nextStep(view, next, run));
      if (!current) return view.steps.markStale();
    }
    // A return to its context joins a manual Refresh, so it runs in any visit.
    await this.#refreshCheckout(current, "hard", { manual: run, visit: null });
  }

  async #prepare(
    view: GitRefreshView,
    prepare: () => Promise<void>,
    run: ManualRun,
  ): Promise<GitRefreshView | null> {
    try {
      await prepare();
    } catch (error) {
      const current = this.#view;
      if (current && this.#continues(view, current)) {
        this.#move(run, manualRefreshKey(current));
        if (!isConnectionFailure(error)) this.#deps.onFailedCheck(errorMessage(error));
        // Local changes do not depend on the target, so they still read once.
        if (current.ready) await Promise.allSettled([current.steps.readLocal()]);
      }
      throw error;
    }
    // The loaded settings change the target in a later render of this context.
    return this.#waitFor((next) => this.#nextStep(view, next, run));
  }

  /** Waits for a ready render of the context, with no failed settings or worktree left. */
  #nextStep(from: GitRefreshView, next: GitRefreshView | null, run: ManualRun): WaitDecision {
    if (!next || !this.#continues(from, next)) return "end";
    if (next.prepare !== null || !next.ready) return "wait";
    this.#move(run, manualRefreshKey(next));
    return "use";
  }

  /**
   * True when `next` shows the context of `from`. A Refresh that starts before the checkout is
   * known belongs to the first checkout that its context knows.
   */
  #continues(from: GitRefreshView, next: GitRefreshView): boolean {
    return (
      next.visible &&
      next.scopeKey === from.scopeKey &&
      (next.branchKey === from.branchKey || !from.ready)
    );
  }

  /** Reads the branch, follows a branch that the read found, and then refreshes Git. */
  async #refreshCheckout(
    view: GitRefreshView,
    mode: GitDiffRefreshMode,
    run: RefreshRun,
  ): Promise<void> {
    let branchKey: string;
    try {
      branchKey = await view.steps.readBranch();
    } catch (error) {
      // A checkout cancels this read. The new checkout has its own refresh.
      if (error instanceof CancelledError) return;
      if (this.#isCurrent(view, run) && !isConnectionFailure(error))
        this.#deps.onFailedCheck(errorMessage(error));
      throw error;
    }
    let current: GitRefreshView | null = view;
    if (branchKey !== view.branchKey) {
      // This refresh found the branch, so its pending state and result move with it.
      if (run.manual) {
        this.#move(run.manual, manualRefreshKey({ scopeKey: view.scopeKey, branchKey }));
      }
      current = await this.#follow(view, branchKey);
      if (!current) return view.steps.markStale();
    }
    if (!this.#isCurrent(current, run)) return current.steps.markStale();
    await this.#refreshGit(current, mode, run);
  }

  async #refreshGit(
    view: GitRefreshView,
    mode: GitDiffRefreshMode,
    run: RefreshRun,
  ): Promise<void> {
    const { steps } = view;
    // Local changes read at once, so a Refresh shows them while the fetch and the check run.
    const earlyLocal = mode === "scheduled" ? null : startEarlyRead(steps.readLocal());
    // Local changes hold the upstream counts, so a fetch makes them read again.
    const fetches = mode === "hard" && steps.comparison !== null;
    const readLocal = (): Promise<void> =>
      fetches || !earlyLocal ? steps.readLocal() : earlyLocal();
    let checkFailure: { error: unknown } | null = null;
    if (steps.comparison) {
      try {
        await this.#fetch(steps.comparison, mode);
        // A fetch can outlive its view. Only the shown view checks its target again.
        if (this.#isCurrent(view, run) && (await steps.comparison.check())) {
          // The new target starts its own reads. Local changes keep their keys, so they read here.
          await (mode === "scheduled" ? steps.readInBackground() : readLocal());
          return;
        }
      } catch (error) {
        checkFailure = { error };
        if (this.#isCurrent(view, run) && !isConnectionFailure(error))
          this.#deps.onFailedCheck(errorMessage(error));
      }
    }
    const reads = this.#isCurrent(view, run)
      ? this.#reads(steps, mode, readLocal)
      : Promise.all([earlyLocal?.(), steps.markStale()]).then(() => undefined);
    if (!checkFailure) return reads;
    // The failed check is the result. Each view keeps its own failed read until a retry.
    await Promise.allSettled([reads]);
    throw checkFailure.error;
  }

  #reads(
    steps: GitRefreshSteps,
    mode: GitDiffRefreshMode,
    readLocal: () => Promise<void>,
  ): Promise<void> {
    if (mode === "scheduled") return steps.readInBackground();
    // A manual Refresh reports a failed History read. Other refreshes leave it to History.
    const historyFailure = mode === "hard" ? "reject" : "show";
    return Promise.all([readLocal(), steps.readComparison(historyFailure)]).then(() => undefined);
  }

  /** A manual fetch always runs. A scheduled fetch waits for its cooldown. */
  async #fetch(comparison: GitRefreshComparison, mode: GitDiffRefreshMode): Promise<void> {
    if (mode === "soft") return;
    const { fetchKey } = comparison;
    const fetchedAt = this.#fetchedAt.get(fetchKey);
    if (
      mode === "scheduled" &&
      fetchedAt !== undefined &&
      this.#deps.now() - fetchedAt < SCHEDULED_FETCH_COOLDOWN_MS
    )
      return;
    let pending = this.#fetches.get(fetchKey);
    if (!pending) {
      pending = this.#runFetch(comparison);
      this.#fetches.set(fetchKey, pending);
    }
    await pending;
  }

  async #runFetch({ fetchKey, fetch }: GitRefreshComparison): Promise<void> {
    try {
      await fetch();
      this.#fetchedAt.set(fetchKey, this.#deps.now());
    } finally {
      this.#fetches.delete(fetchKey);
    }
  }

  /** Waits for the render of the found branch. Another context ends the refresh. */
  #follow(from: GitRefreshView, branchKey: string): Promise<GitRefreshView | null> {
    return this.#waitFor((next) => {
      if (!next?.visible || next.scopeKey !== from.scopeKey) return "end";
      if (next.branchKey === branchKey) return next.ready ? "use" : "wait";
      return next.branchKey === from.branchKey ? "wait" : "end";
    });
  }

  #waitFor(decide: (view: GitRefreshView | null) => WaitDecision): Promise<GitRefreshView | null> {
    return new Promise((resolve) => {
      const check = (view: GitRefreshView | null) => {
        const decision = decide(view);
        if (decision === "wait") return;
        this.#waiters.delete(check);
        resolve(decision === "use" ? view : null);
      };
      this.#waiters.add(check);
      check(this.#view);
    });
  }

  #move(run: ManualRun, key: string): void {
    if (run.key === key) return;
    if (this.#manualRuns.get(run.key) === run) this.#manualRuns.delete(run.key);
    run.key = key;
    this.#manualRuns.set(key, run);
    this.#notify();
  }

  /** True while the view shows the context of `view`, in the visit of `run` when it has one. */
  #isCurrent(view: GitRefreshView, run?: RefreshRun): boolean {
    const current = this.#view;
    return (
      current !== null &&
      current.visible &&
      current.scopeKey === view.scopeKey &&
      current.branchKey === view.branchKey &&
      (run?.visit == null || run.visit === this.#visit)
    );
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
