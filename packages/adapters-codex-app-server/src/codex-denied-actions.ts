import type {
  AgentSessionDeniedAction,
  AgentToolDenial,
  AgentToolPart,
  CodexAppServerAutoApprovalReviewCompletedParams,
} from "@openducktor/contracts";
import type { AgentSessionSummary, PolicyBoundSessionRef } from "@openducktor/core";
import { z } from "zod";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import {
  codexPermissionRequestDeniedPart,
  projectCodexAutoReviewDenial,
} from "./codex-auto-review-denials";
import { toCodexGuardianAssessmentEvent } from "./codex-guardian-assessment-event";
import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexNativeServerRequest } from "./codex-pending-input-state";
import { findRetainedSessionOwner } from "./codex-retained-session-owner";
import { requireCodexRuntimePolicy } from "./codex-session-policy";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";
import { type CodexDeniedActionClaim, CodexToolDenials } from "./codex-tool-denials";
import { runningTurnOf } from "./codex-turn-lifecycle";
import type { CodexAppServerClient, CodexSessionState } from "./types";

export type CodexDeniedActionLocator = {
  readonly runtimeId: string;
  readonly externalSessionId: string;
  readonly callId: string;
};

/** The capabilities of the adapter that the denied actions use. */
export type CodexDeniedActionsAdapterDeps = {
  /** Reads whether Codex takes direct input on a loaded thread. `null`: Codex did not report it. */
  readonly readThreadDirectInput: (runtimeId: string, threadId: string) => Promise<boolean | null>;
  readonly clientForRuntime: (runtimeId: string) => CodexAppServerClient;
  readonly ensureSessionState: (input: PolicyBoundSessionRef) => Promise<AgentSessionSummary>;
  /** Starts one turn without user input on a retained session. */
  readonly startContinuationTurn: (threadId: string) => Promise<void>;
};

/** The capabilities of the runtime events and the session state that the denied actions use. */
export type CodexDeniedActionsDeps = CodexDeniedActionsAdapterDeps & {
  readonly sessions: Pick<CodexSessionLookup, "get">;
  readonly subagents: Pick<CodexSubagentLinkState, "routeForChild" | "statusForChild">;
  readonly activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  /** The session that shows the events of the thread, or undefined when none is live. */
  readonly resolveTargetSession: (
    runtimeId: string,
    threadId: string,
  ) => CodexSessionState | undefined;
  readonly emitPart: (session: CodexSessionState, part: AgentToolPart, timestamp: string) => void;
  readonly markSnapshotChanged: (runtimeId: string, threadId: string) => void;
  /** Runs an update in the runtime queue, after the runtime events before it. */
  readonly enqueueLiveUpdate: (runtimeId: string, update: () => void) => void;
};

/** A typed permission profile has optional fields, so the row input reads it as JSON once. */
const jsonValueSchema = z.json();

/** Where a read-only role reject shows: on the tool item of the request, or on its own row. */
type ReadOnlyDenialTarget =
  | { readonly kind: "item"; readonly itemId: string }
  | { readonly kind: "own_row"; readonly part: AgentToolPart };

const readOnlyDenialTarget = (
  nativeRequest: CodexNativeServerRequest,
  denial: AgentToolDenial,
): ReadOnlyDenialTarget | null => {
  switch (nativeRequest.method) {
    case "execCommandApproval":
    case "applyPatchApproval":
      return { kind: "item", itemId: nativeRequest.params.callId };
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { kind: "item", itemId: nativeRequest.params.itemId };
    case "item/permissions/requestApproval": {
      // Codex creates no tool item for a permission request.
      const { itemId, reason, permissions, startedAtMs } = nativeRequest.params;
      return {
        kind: "own_row",
        part: codexPermissionRequestDeniedPart(
          itemId,
          { reason, permissions: jsonValueSchema.parse(permissions), startedAtMs },
          denial,
        ),
      };
    }
    default:
      return null;
  }
};

/**
 * The tool calls of live Codex sessions that a policy denied, and the Allow flow of the denials
 * that the user can allow. Each later emission of a denied call carries its denial. The state
 * lives in memory only, until the session stops.
 */
export class CodexDeniedActions {
  private readonly denials = new CodexToolDenials();

  constructor(private readonly deps: CodexDeniedActionsDeps) {}

  /** Adds the denial of the call to the part. */
  decorate(runtimeId: string, threadId: string, part: AgentToolPart): AgentToolPart {
    return this.denials.decorate(runtimeId, threadId, part);
  }

  /** The Allow entries of the thread snapshot, or undefined when the thread has none. */
  snapshotEntries(runtimeId: string, threadId: string): AgentSessionDeniedAction[] | undefined {
    return this.denials.deniedActions(runtimeId, threadId);
  }

  clearThread(runtimeId: string | undefined, threadId: string): void {
    this.denials.clearThread(runtimeId, threadId);
  }

  clearRuntime(runtimeId: string): void {
    this.denials.clearRuntime(runtimeId);
  }

  /**
   * Marks the reviewed call as denied, and updates its row when the call already shows. The user
   * can allow the call only on a thread that takes direct input, because Codex refuses the
   * approval and the follow-up turn on other threads.
   */
  async applyAutoApprovalReview(
    session: CodexSessionState,
    params: CodexAppServerAutoApprovalReviewCompletedParams,
    receivedAt: string,
  ): Promise<void> {
    const projection = projectCodexAutoReviewDenial(params);
    if (!projection) return;
    const { runtimeId, threadId } = session;
    const runningPart = this.denials.recordDenial(
      runtimeId,
      threadId,
      projection.callId,
      projection.denial,
    );
    const runningParent =
      projection.parentCallId === undefined
        ? undefined
        : this.denials.recordDenial(
            runtimeId,
            threadId,
            projection.parentCallId,
            projection.denial,
          );
    this.deps.markSnapshotChanged(runtimeId, threadId);
    for (const part of [runningParent, projection.part ?? runningPart]) {
      if (part) this.deps.emitPart(session, part, receivedAt);
    }
    const action = projection.allowableAction;
    if (!action || !(await this.acceptsDirectInput(session))) return;
    // The session can stop while the adapter reads the thread.
    if (!this.deps.resolveTargetSession(runtimeId, threadId)) return;
    this.denials.recordAllowableReview(runtimeId, threadId, projection.callId, params, action);
  }

  /**
   * Shows the reject of an approval request that the host sent for the read-only role. Call it
   * when the reply is issued: Codex then ends the rejected item, and that emission carries the
   * denial. A permission request has no tool item, so it shows on its own row.
   */
  recordReadOnlyRoleReject(
    runtimeId: string,
    threadId: string,
    nativeRequest: CodexNativeServerRequest,
    message: string | undefined,
  ): void {
    const denial: AgentToolDenial = message
      ? { source: "read_only_role", reason: message }
      : { source: "read_only_role" };
    const target = readOnlyDenialTarget(nativeRequest, denial);
    if (target?.kind === "item") {
      this.denials.recordDenial(runtimeId, threadId, target.itemId, denial);
    } else if (target?.kind === "own_row") {
      this.emitOwnRow(runtimeId, threadId, target.part, denial);
    }
  }

  /** Moves an `available` denied action to `sending`, so only one Allow request runs. */
  claim({
    runtimeId,
    externalSessionId,
    callId,
  }: CodexDeniedActionLocator): CodexDeniedActionClaim {
    return this.denials.claim(runtimeId, externalSessionId, callId);
  }

  /** Gives a claimed denied action back when its Allow request did not run. */
  release({ runtimeId, externalSessionId, callId }: CodexDeniedActionLocator, failure: string) {
    this.denials.release(runtimeId, externalSessionId, callId, failure);
  }

  /**
   * Sends the user approval of a claimed denied review to Codex. Codex records it for the model
   * and starts no turn, so an idle thread gets one follow-up turn. A failed approval makes Allow
   * available again. A failed follow-up keeps the approval, because Codex already holds it.
   */
  async allow({
    runtimeId,
    externalSessionId: threadId,
    callId,
  }: CodexDeniedActionLocator): Promise<void> {
    const review = this.denials.claimedReview(runtimeId, threadId, callId);
    try {
      await this.deps.clientForRuntime(runtimeId).threadApproveGuardianDeniedAction({
        threadId: review.params.threadId,
        event: toCodexGuardianAssessmentEvent(review.params, review.action),
      });
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.denials.settle(runtimeId, threadId, callId, "available", failure);
      throw error;
    }
    this.denials.settle(runtimeId, threadId, callId, "allowed");
    if (this.hasActiveTurn(runtimeId, threadId)) return;
    try {
      await this.startFollowUp(runtimeId, threadId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = `Codex received the approval, but the agent did not continue: ${reason} Send a message to let the agent continue.`;
      this.denials.settle(runtimeId, threadId, callId, "allowed", message);
      throw new Error(message, { cause: error });
    }
  }

  /** Shows a denied call that has no Codex tool item, after the runtime events before it. */
  private emitOwnRow(
    runtimeId: string,
    threadId: string,
    part: AgentToolPart,
    denial: AgentToolDenial,
  ): void {
    this.deps.enqueueLiveUpdate(runtimeId, () => {
      const session = this.deps.resolveTargetSession(runtimeId, threadId);
      if (!session) return;
      this.denials.recordDenial(session.runtimeId, session.threadId, part.callId, denial);
      this.deps.emitPart(session, part, new Date().toISOString());
    });
  }

  /**
   * A retained thread keeps the capability that Codex reported when OpenDucktor started or
   * resumed it. Codex reports it for every loaded thread, and a thread that OpenDucktor started
   * is never a child, so an unknown value is allowed only for a main thread. A routed child has
   * no retained state, so the adapter reads it.
   */
  private async acceptsDirectInput(session: CodexSessionState): Promise<boolean> {
    const { runtimeId, threadId } = session;
    const isChild = this.deps.subagents.routeForChild(threadId, runtimeId) !== null;
    const retained = this.deps.sessions.get(threadId);
    if (retained?.runtimeId === runtimeId) return retained.canAcceptDirectInput ?? !isChild;
    const canAccept = await this.deps.readThreadDirectInput(runtimeId, threadId);
    return canAccept ?? !isChild;
  }

  private hasActiveTurn(runtimeId: string, threadId: string): boolean {
    const session = this.deps.sessions.get(threadId);
    if (session?.runtimeId === runtimeId) {
      return (
        runningTurnOf(this.deps.activeTurnsBySessionId, threadId) !== null ||
        (session.liveStatus !== undefined && session.liveStatus.classification !== "idle")
      );
    }
    const childStatus = this.deps.subagents.statusForChild(threadId, runtimeId);
    return childStatus === "pending" || childStatus === "running";
  }

  /**
   * An idle child thread has no retained session, so the adapter retains it with the scope and
   * policy of its retained ancestor before it starts the turn.
   */
  private async startFollowUp(runtimeId: string, threadId: string): Promise<void> {
    if (this.deps.sessions.get(threadId)?.runtimeId !== runtimeId) {
      const owner = findRetainedSessionOwner({
        sessions: this.deps.sessions,
        subagents: this.deps.subagents,
        runtimeId,
        threadId,
      });
      if (!owner) throw new Error(`Codex session '${threadId}' is no longer loaded.`);
      const ancestor = owner.retainedSession;
      const association = ancestor.summary.sessionAssociation;
      if (association.kind === "unbound") {
        throw new Error(`Codex session '${ancestor.threadId}' has no session scope.`);
      }
      await this.deps.ensureSessionState({
        repoPath: ancestor.repoPath,
        runtimeKind: "codex",
        workingDirectory: ancestor.workingDirectory,
        externalSessionId: threadId,
        // The title of a repository session belongs to the ancestor, not to the child.
        sessionScope:
          association.kind === "repository"
            ? { kind: "repository", workspaceId: association.workspaceId }
            : association,
        runtimePolicy: {
          kind: "codex",
          policy: requireCodexRuntimePolicy(ancestor.runtimePolicy, "continue a Codex child"),
        },
      });
    }
    await this.deps.startContinuationTurn(threadId);
  }
}
