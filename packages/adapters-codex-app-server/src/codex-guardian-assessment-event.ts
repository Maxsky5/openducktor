import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  agentToolDenialRiskLevelSchema,
  type CodexAppServerAutoApprovalReviewCompletedParams,
} from "@openducktor/contracts";
import { z } from "zod";

/** The review cannot become the native event that `thread/approveGuardianDeniedAction` takes. */
export class CodexGuardianEventConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexGuardianEventConversionError";
  }
}

const commandSourceSchema = z.enum(["shell", "unifiedExec"]);
const networkProtocolSchema = z.enum(["http", "https", "socks5Tcp", "socks5Udp"]);

/**
 * The app-server actions of codex-cli 0.170.0 that OpenDucktor can send back as core actions.
 * `requestPermissions` carries a permission profile whose paths Codex converts with its own path
 * rules, so OpenDucktor shows it without an Allow action.
 */
const allowableActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    source: commandSourceSchema,
    command: z.string(),
    cwd: z.string(),
  }),
  z.object({
    type: z.literal("execve"),
    source: commandSourceSchema,
    program: z.string(),
    argv: z.array(z.string()),
    cwd: z.string(),
  }),
  z.object({
    type: z.literal("writeStdin"),
    approvalId: z.string(),
    processId: z.string(),
    stdin: z.string(),
    cwd: z.string(),
  }),
  z.object({ type: z.literal("applyPatch"), cwd: z.string(), files: z.array(z.string()) }),
  z.object({
    type: z.literal("networkAccess"),
    target: z.string(),
    host: z.string(),
    protocol: networkProtocolSchema,
    port: z.number().int(),
  }),
  z.object({
    type: z.literal("mcpToolCall"),
    server: z.string(),
    toolName: z.string(),
    connectorId: z.string().nullable(),
    connectorName: z.string().nullable(),
    toolTitle: z.string().nullable(),
  }),
]);
/** An auto-review action that OpenDucktor can send back to Codex. */
export type CodexAllowableReviewAction = z.output<typeof allowableActionSchema>;

/** A parsed auto-review action, or the type of one that OpenDucktor cannot send back. */
export type CodexReviewAction =
  | CodexAllowableReviewAction
  | { readonly type: "other"; readonly actionType: string };

/** Parses an auto-review action once, for its row, its Allow entry, and its native event. */
export const parseCodexReviewAction = (
  action: CodexAppServerAutoApprovalReviewCompletedParams["action"],
): CodexReviewAction =>
  allowableActionSchema.safeParse(action).data ?? { type: "other", actionType: action.type };

/** The review fields of the native event. The action is parsed by `parseCodexReviewAction`. */
const deniedReviewSchema = z.object({
  reviewId: z.string(),
  turnId: z.string(),
  startedAtMs: z.number(),
  completedAtMs: z.number().optional(),
  decisionSource: z.literal("agent").nullable().optional(),
  review: z.object({
    status: z.literal("denied"),
    riskLevel: agentToolDenialRiskLevelSchema.nullable().optional(),
    userAuthorization: z.enum(["unknown", "low", "medium", "high"]).nullable().optional(),
    rationale: z.string().nullable().optional(),
  }),
});

const COMMAND_SOURCES = { shell: "shell", unifiedExec: "unified_exec" } as const;
const NETWORK_PROTOCOLS = {
  http: "http",
  https: "https",
  socks5Tcp: "socks5_tcp",
  socks5Udp: "socks5_udp",
} as const;

/** Codex keeps the terminal directory of a stdin review as a `file:` URI. */
const toPathUri = (path: string): string => {
  if (path.startsWith("file:")) return path;
  if (!isAbsolute(path)) {
    throw new CodexGuardianEventConversionError(
      `Codex auto-review action 'writeStdin' has a relative directory '${path}'.`,
    );
  }
  return pathToFileURL(path).href;
};

/** Converts the camelCase app-server action to the snake_case core action, as the Codex TUI does. */
const toCoreAction = (action: CodexAllowableReviewAction) => {
  switch (action.type) {
    case "command":
      return {
        type: "command",
        source: COMMAND_SOURCES[action.source],
        command: action.command,
        cwd: action.cwd,
      };
    case "execve":
      return {
        type: "execve",
        source: COMMAND_SOURCES[action.source],
        program: action.program,
        argv: action.argv,
        cwd: action.cwd,
      };
    case "writeStdin":
      return {
        type: "write_stdin",
        approval_id: action.approvalId,
        process_id: action.processId,
        stdin: action.stdin,
        cwd: toPathUri(action.cwd),
      };
    case "applyPatch":
      return { type: "apply_patch", cwd: action.cwd, files: action.files };
    case "networkAccess":
      return {
        type: "network_access",
        target: action.target,
        host: action.host,
        protocol: NETWORK_PROTOCOLS[action.protocol],
        port: action.port,
      };
    case "mcpToolCall":
      return {
        type: "mcp_tool_call",
        server: action.server,
        tool_name: action.toolName,
        connector_id: action.connectorId,
        connector_name: action.connectorName,
        tool_title: action.toolTitle,
      };
  }
};

/** The serialized core `GuardianAssessmentEvent` of codex-cli 0.170.0 (`protocol/src/approvals.rs`). */
type CodexGuardianAssessmentEvent = {
  id: string;
  turn_id: string;
  started_at_ms: number;
  completed_at_ms?: number;
  status: "denied";
  risk_level?: "low" | "medium" | "high" | "critical";
  user_authorization?: "unknown" | "low" | "medium" | "high";
  rationale?: string;
  decision_source?: "agent";
  action: ReturnType<typeof toCoreAction>;
};

/**
 * Builds the serialized core `GuardianAssessmentEvent` of a denied review, with the fields that
 * the Codex TUI sets from the same notification (`tui/src/chatwidget/protocol_requests.rs`).
 */
export const toCodexGuardianAssessmentEvent = (
  params: CodexAppServerAutoApprovalReviewCompletedParams,
  action: CodexAllowableReviewAction,
): CodexGuardianAssessmentEvent => {
  const parsed = deniedReviewSchema.safeParse(params);
  if (!parsed.success) {
    throw new CodexGuardianEventConversionError(
      `OpenDucktor cannot send this Codex auto-review back to Codex: ${z.prettifyError(parsed.error)}`,
    );
  }
  const { review, decisionSource, completedAtMs } = parsed.data;
  const event: CodexGuardianAssessmentEvent = {
    id: parsed.data.reviewId,
    turn_id: parsed.data.turnId,
    started_at_ms: parsed.data.startedAtMs,
    status: "denied",
    action: toCoreAction(action),
  };
  if (completedAtMs !== undefined) event.completed_at_ms = completedAtMs;
  if (review.riskLevel) event.risk_level = review.riskLevel;
  if (review.userAuthorization) event.user_authorization = review.userAuthorization;
  if (review.rationale) event.rationale = review.rationale;
  if (decisionSource) event.decision_source = decisionSource;
  return event;
};
