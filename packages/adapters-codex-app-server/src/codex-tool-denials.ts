import type {
  AgentSessionDeniedAction,
  AgentToolDenial,
  AgentToolPart,
  CodexAppServerAutoApprovalReviewCompletedParams,
} from "@openducktor/contracts";
import type { CodexAllowableReviewAction } from "./codex-guardian-assessment-event";

/** A denied auto-review that the user can allow while the session runs. */
export type CodexDeniedReview = {
  readonly callId: string;
  readonly params: CodexAppServerAutoApprovalReviewCompletedParams;
  /** The parsed action of the review, which the native approval event carries. */
  readonly action: CodexAllowableReviewAction;
  state: AgentSessionDeniedAction["state"];
  failure?: string;
};

export type CodexDeniedActionClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "unavailable"; readonly message: string };

/** The denial state of one thread, by call ID. */
type ThreadDenials = {
  readonly denials: Map<string, AgentToolDenial>;
  /** The last emission of each running call, so that a denial can update its row at once. */
  readonly runningParts: Map<string, AgentToolPart>;
  readonly reviews: Map<string, CodexDeniedReview>;
};

const isRunningToolPart = (part: AgentToolPart): boolean =>
  part.status === "pending" || part.status === "running";

/**
 * The tool calls that a policy denied in live sessions. Each later emission of a denied call
 * carries its denial. The adapter keeps this state in memory only, until the session stops.
 */
export class CodexToolDenials {
  private readonly threadsByRuntimeId = new Map<string, Map<string, ThreadDenials>>();

  /** Adds the denial of the call to the part, and remembers the part while the call runs. */
  decorate(runtimeId: string, threadId: string, part: AgentToolPart): AgentToolPart {
    const thread = this.thread(runtimeId, threadId);
    const denial = thread?.denials.get(part.callId);
    const decorated = denial ? { ...part, denial } : part;
    if (isRunningToolPart(decorated)) {
      this.ensureThread(runtimeId, threadId).runningParts.set(part.callId, decorated);
    } else {
      thread?.runningParts.delete(part.callId);
    }
    return decorated;
  }

  /**
   * Records the denial of a call. A later denial of the same call replaces it and its Allow
   * entry. Returns the last emission of the call when it still runs, so the caller can emit it
   * again with the denial.
   */
  recordDenial(
    runtimeId: string,
    threadId: string,
    callId: string,
    denial: AgentToolDenial,
  ): AgentToolPart | undefined {
    const thread = this.ensureThread(runtimeId, threadId);
    thread.denials.set(callId, denial);
    thread.reviews.delete(callId);
    return thread.runningParts.get(callId);
  }

  /** Lets the user allow the denied review of the call. */
  recordAllowableReview(
    runtimeId: string,
    threadId: string,
    callId: string,
    params: CodexAppServerAutoApprovalReviewCompletedParams,
    action: CodexAllowableReviewAction,
  ): void {
    this.ensureThread(runtimeId, threadId).reviews.set(callId, {
      callId,
      params,
      action,
      state: "available",
    });
  }

  /** The Allow entries of the thread snapshot, or undefined when the thread has none. */
  deniedActions(runtimeId: string, threadId: string): AgentSessionDeniedAction[] | undefined {
    const reviews = this.thread(runtimeId, threadId)?.reviews;
    if (!reviews?.size) return undefined;
    return [...reviews.values()].map(({ callId, state, failure }) =>
      failure === undefined ? { callId, state } : { callId, state, failure },
    );
  }

  /** Moves an `available` entry to `sending`. Only one Allow request runs for each call. */
  claim(runtimeId: string, threadId: string, callId: string): CodexDeniedActionClaim {
    const review = this.review(runtimeId, threadId, callId);
    if (!review) {
      return {
        kind: "unavailable",
        message:
          "This denied call can no longer be allowed. The session stopped, or Codex reviewed the call again. Ask the agent to try again.",
      };
    }
    if (review.state === "sending") {
      return { kind: "unavailable", message: "Allow is already running for this call." };
    }
    if (review.state === "allowed") {
      return { kind: "unavailable", message: "This call is already allowed." };
    }
    review.state = "sending";
    delete review.failure;
    return { kind: "claimed" };
  }

  /** Returns the review of a claimed entry. */
  claimedReview(runtimeId: string, threadId: string, callId: string): CodexDeniedReview {
    const review = this.review(runtimeId, threadId, callId);
    if (review?.state !== "sending") {
      throw new Error(`Codex has no Allow request in progress for call '${callId}'.`);
    }
    return review;
  }

  /** Sets the outcome of an Allow request. A session that stopped meanwhile has no entry. */
  settle(
    runtimeId: string,
    threadId: string,
    callId: string,
    state: "available" | "allowed",
    failure?: string,
  ): void {
    const review = this.review(runtimeId, threadId, callId);
    if (!review) return;
    review.state = state;
    if (failure === undefined) delete review.failure;
    else review.failure = failure;
  }

  /** Gives a claimed entry back when its Allow request did not run. */
  release(runtimeId: string, threadId: string, callId: string, failure: string): void {
    if (this.review(runtimeId, threadId, callId)?.state === "sending") {
      this.settle(runtimeId, threadId, callId, "available", failure);
    }
  }

  /** Forgets a thread. Without a runtime, it forgets the thread in every runtime. */
  clearThread(runtimeId: string | undefined, threadId: string): void {
    for (const [entryRuntimeId, threads] of this.threadsByRuntimeId) {
      if (runtimeId !== undefined && entryRuntimeId !== runtimeId) continue;
      threads.delete(threadId);
      if (threads.size === 0) this.threadsByRuntimeId.delete(entryRuntimeId);
    }
  }

  clearRuntime(runtimeId: string): void {
    this.threadsByRuntimeId.delete(runtimeId);
  }

  private thread(runtimeId: string, threadId: string): ThreadDenials | undefined {
    return this.threadsByRuntimeId.get(runtimeId)?.get(threadId);
  }

  private review(
    runtimeId: string,
    threadId: string,
    callId: string,
  ): CodexDeniedReview | undefined {
    return this.thread(runtimeId, threadId)?.reviews.get(callId);
  }

  private ensureThread(runtimeId: string, threadId: string): ThreadDenials {
    let threads = this.threadsByRuntimeId.get(runtimeId);
    if (!threads) {
      threads = new Map();
      this.threadsByRuntimeId.set(runtimeId, threads);
    }
    let thread = threads.get(threadId);
    if (!thread) {
      thread = { denials: new Map(), runningParts: new Map(), reviews: new Map() };
      threads.set(threadId, thread);
    }
    return thread;
  }
}
