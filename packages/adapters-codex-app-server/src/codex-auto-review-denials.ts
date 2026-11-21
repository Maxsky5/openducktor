import type {
  AgentToolData,
  AgentToolDenial,
  AgentToolPart,
  CodexAppServerAutoApprovalReviewCompletedParams,
} from "@openducktor/contracts";
import {
  type CodexAllowableReviewAction,
  type CodexReviewAction,
  parseCodexReviewAction,
} from "./codex-guardian-assessment-event";

export type CodexAutoReviewDenial = {
  readonly callId: string;
  readonly denial: AgentToolDenial;
  /** The action that the user can allow, or null when the user cannot allow the call. */
  readonly allowableAction: CodexAllowableReviewAction | null;
  /** The row of a review that names no tool item of its own. */
  readonly part?: AgentToolPart;
  /**
   * The command item that Codex declines with an `execve` review. It shows the denial too, but has
   * no Allow, because the review row holds the Allow of that one program call.
   */
  readonly parentCallId?: string;
};

const toolDenial = (
  review: CodexAppServerAutoApprovalReviewCompletedParams["review"],
): AgentToolDenial | null => {
  if (review.status !== "denied" && review.status !== "timedOut") return null;
  const denial: AgentToolDenial = {
    source: review.status === "denied" ? "auto_review" : "auto_review_timeout",
  };
  if (review.rationale) denial.reason = review.rationale;
  if (review.riskLevel) denial.riskLevel = review.riskLevel;
  return denial;
};

/**
 * Reviews that get their own row. One command item can hold several reviewed `execve` calls and
 * its terminal input, and Codex creates no tool item for a permission request.
 */
const OWN_ROW_REVIEW_TYPES = new Set(["execve", "writeStdin", "requestPermissions"]);

const SHELL_SAFE_ARGUMENT = /^[\w@%+=:,./-]+$/;
const shellQuote = (argument: string): string =>
  SHELL_SAFE_ARGUMENT.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`;

const PERMISSION_REQUEST_TITLE = "Additional permissions";

const actionTitle = (action: CodexReviewAction): string => {
  switch (action.type) {
    case "networkAccess":
      return `Network access to ${action.host}`;
    case "writeStdin":
      return "Input to a running command";
    case "execve": {
      // Codex shows the command as `program`, then the arguments after `argv[0]`.
      const command = [action.program, ...action.argv.slice(1)].map(shellQuote).join(" ");
      return `Program call ${command}`;
    }
    case "other":
      return action.actionType === "requestPermissions"
        ? PERMISSION_REQUEST_TITLE
        : `Auto-review action ${action.actionType}`;
    default:
      return `Auto-review action ${action.type}`;
  }
};

/** A generic, failed tool part with one ID, for a denied call that has no Codex tool item. */
const ownRowToolPart = (input: {
  callId: string;
  tool: string;
  title: string;
  input: AgentToolData;
  startedAtMs: number;
  endedAtMs?: number | undefined;
}): AgentToolPart => {
  const part: AgentToolPart = {
    kind: "tool",
    messageId: input.callId,
    partId: input.callId,
    callId: input.callId,
    tool: input.tool,
    toolType: "generic",
    title: input.title,
    status: "error",
    input: input.input,
    startedAtMs: input.startedAtMs,
  };
  if (input.endedAtMs !== undefined) part.endedAtMs = input.endedAtMs;
  return part;
};

/**
 * Maps a completed Codex auto-review to the denial of its call. Only `denied` and `timedOut`
 * reviews deny a call. An `execve` or terminal input review shares its item with the command
 * that runs, and one command can have several of them, so each gets its own row and Allow. A
 * permission request and a network review have no tool item, so they get their own row too.
 */
export const projectCodexAutoReviewDenial = (
  params: CodexAppServerAutoApprovalReviewCompletedParams,
): CodexAutoReviewDenial | null => {
  const denial = toolDenial(params.review);
  if (!denial) return null;
  const action = parseCodexReviewAction(params.action);
  const allowableAction =
    denial.source === "auto_review" && action.type !== "other" ? action : null;
  if (params.targetItemId !== null && !OWN_ROW_REVIEW_TYPES.has(params.action.type)) {
    return { callId: params.targetItemId, denial, allowableAction };
  }
  const callId = `auto-review:${params.reviewId}`;
  const { type, ...input } = params.action;
  const part = ownRowToolPart({
    callId,
    tool: type,
    title: actionTitle(action),
    input,
    startedAtMs: params.startedAtMs,
    endedAtMs: params.completedAtMs,
  });
  return params.action.type === "execve" && params.targetItemId !== null
    ? { callId, denial, allowableAction, part, parentCallId: params.targetItemId }
    : { callId, denial, allowableAction, part };
};

/** The row of a permission request that the host rejected for the read-only role. */
export const codexPermissionRequestDeniedPart = (
  callId: string,
  request: { reason: string | null; permissions: AgentToolData[string]; startedAtMs: number },
  denial: AgentToolDenial,
): AgentToolPart => {
  const input: AgentToolData = { permissions: request.permissions };
  if (request.reason) input.reason = request.reason;
  return {
    ...ownRowToolPart({
      callId,
      tool: "requestPermissions",
      title: PERMISSION_REQUEST_TITLE,
      input,
      startedAtMs: request.startedAtMs,
    }),
    denial,
  };
};
