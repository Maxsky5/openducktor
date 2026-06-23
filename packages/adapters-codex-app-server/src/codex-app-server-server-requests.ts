import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentEvent,
  normalizeOdtWorkflowToolName,
} from "@openducktor/core";
import {
  classifyCodexRequestMutation,
  codexApprovalResponseForRequest,
  extractTurnId,
  parseQuestionRequest,
  toApprovalRequest,
  toMcpElicitationApprovalRequest,
} from "./codex-app-server-requests";
import { type ActiveCodexTurn, CODEX_USER_INPUT_REQUEST_METHOD } from "./codex-app-server-shared";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import { READ_ONLY_ROLES } from "./codex-session-policy";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";
import type {
  CodexServerRequestRecord,
  CodexServerRequestResponder,
  CodexSessionState,
} from "./types";

const odtWorkflowToolRoleRejection = (
  session: CodexSessionState,
  serverName: unknown,
  toolName: string | undefined,
): string | null => {
  if (serverName !== "openducktor") {
    return null;
  }

  if (!toolName) {
    return null;
  }

  const workflowTool = normalizeOdtWorkflowToolName(toolName);
  if (!workflowTool) {
    return null;
  }

  if (!session.role) {
    return `the session role is unknown`;
  }

  return AGENT_ROLE_TOOL_POLICY[session.role].includes(workflowTool)
    ? null
    : `role '${session.role}' is not allowed to use ${workflowTool}`;
};

export type CodexServerRequestHandlerContext = {
  respondServerRequest: CodexServerRequestResponder;
  pendingInput: CodexPendingInputState;
  activeTurnsBySessionId: Map<string, ActiveCodexTurn>;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string): boolean;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
};

export const handleCodexServerRequest = async (
  context: CodexServerRequestHandlerContext,
  session: CodexSessionState,
  rawRequest: CodexServerRequestRecord,
  handledRequestKeys: Set<string>,
): Promise<boolean> => {
  const requestId = rawRequest.id;
  const requestKey = requestId !== undefined ? `request:${requestId}` : undefined;
  if (requestKey && handledRequestKeys.has(requestKey)) {
    return false;
  }

  if (requestKey) {
    handledRequestKeys.add(requestKey);
  }

  if (typeof rawRequest.method !== "string" || rawRequest.method.trim().length === 0) {
    throw new Error("Codex app-server server request is missing method.");
  }

  const requestTurnId = extractTurnId(rawRequest.params);
  const activeTurn = context.activeTurnsBySessionId.get(session.threadId);
  if (requestTurnId && activeTurn && context.bindActiveTurnId(activeTurn, requestTurnId)) {
    context.flushQueuedUserMessagesLater(activeTurn);
  }

  const mcpElicitationApproval = toMcpElicitationApprovalRequest(rawRequest);
  if (mcpElicitationApproval) {
    if (requestId === undefined) {
      throw new Error("Codex MCP elicitation request is missing an id.");
    }

    const roleRejection = odtWorkflowToolRoleRejection(
      session,
      mcpElicitationApproval.metadata?.serverName,
      mcpElicitationApproval.tool?.name,
    );
    if (roleRejection) {
      await context.respondServerRequest(
        session.runtimeId,
        requestId,
        codexApprovalResponseForRequest({
          outcome: "reject",
          request: rawRequest,
          message: `Codex MCP request '${mcpElicitationApproval.tool?.name}' was rejected because ${roleRejection}.`,
        }),
        undefined,
      );
      context.emitSessionEvent(session.threadId, {
        type: "session_error",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        message: `Rejected Codex MCP request '${mcpElicitationApproval.tool?.name}' because ${roleRejection}.`,
      });
      return false;
    }

    context.pendingInput.addApproval({
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      request: mcpElicitationApproval,
    });
    context.emitSessionEvent(session.threadId, {
      ...mcpElicitationApproval,
      type: "approval_required",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (rawRequest.method === CODEX_USER_INPUT_REQUEST_METHOD) {
    const parsed = parseQuestionRequest(rawRequest);
    if (parsed.threadId !== session.threadId) {
      throw new Error(
        `Codex question request thread '${parsed.threadId}' does not match active session '${session.threadId}'.`,
      );
    }
    if (activeTurn && context.bindActiveTurnId(activeTurn, parsed.turnId)) {
      context.flushQueuedUserMessagesLater(activeTurn);
    }
    const questionInput = {
      requestId: parsed.request.requestId,
      questions: parsed.request.questions,
    };
    context.pendingInput.addQuestion({
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      request: parsed.request,
      questionIds: parsed.questionIds,
      input: questionInput,
    });
    context.emitSessionEvent(session.threadId, {
      ...parsed.request,
      type: "question_required",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
    });
    context.emitSessionEvent(session.threadId, {
      type: "assistant_part",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
      part: requireNormalizedCodexToolInvocation({
        messageId: `codex-question-${parsed.request.requestId}`,
        partId: `codex-question-${parsed.request.requestId}`,
        callId: parsed.request.requestId,
        rawToolName: "request_user_input",
        status: "running",
        input: questionInput,
        metadata: {
          codexServerRequest: true,
          method: rawRequest.method,
          requestId: parsed.request.requestId,
          questions: parsed.request.questions,
          questionIds: parsed.questionIds,
          turnId: parsed.turnId,
        },
      }),
    });
    return true;
  }

  if (rawRequest.method !== "item/tool/call") {
    if (requestId === undefined) {
      throw new Error(`Codex app-server server request '${rawRequest.method}' is missing an id.`);
    }
    const requestMutation = classifyCodexRequestMutation(rawRequest);
    if (session.role && READ_ONLY_ROLES.has(session.role) && requestMutation === "read_only") {
      await context.respondServerRequest(
        session.runtimeId,
        requestId,
        codexApprovalResponseForRequest({ outcome: "approve_once", request: rawRequest }),
        undefined,
      );
      return false;
    }

    const isMutatingRequest = requestMutation === "mutating";
    const shouldRejectForRole =
      !session.role || (isMutatingRequest && READ_ONLY_ROLES.has(session.role));
    if (shouldRejectForRole) {
      const roleReason = session.role
        ? `role '${session.role}' is read-only`
        : "the session role is unknown";
      await context.respondServerRequest(
        session.runtimeId,
        requestId,
        codexApprovalResponseForRequest({
          outcome: "reject",
          request: rawRequest,
          message: `Codex request '${rawRequest.method}' was rejected because ${roleReason}.`,
        }),
        undefined,
      );
      context.emitSessionEvent(session.threadId, {
        type: "session_error",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        message: `Rejected ${isMutatingRequest ? "mutating " : ""}Codex request '${rawRequest.method}' because ${roleReason}.`,
      });
      return false;
    }

    const role = session.role;
    if (!role) {
      throw new Error("Codex approval request cannot be created without a session role.");
    }
    const approval = toApprovalRequest(rawRequest, role);
    context.pendingInput.addApproval({
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      request: approval,
    });
    context.emitSessionEvent(session.threadId, {
      ...approval,
      type: "approval_required",
      externalSessionId: session.threadId,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (requestId === undefined) {
    throw new Error("Codex app-server tool request is missing a numeric id.");
  }

  // Dynamic Codex tool calls are never approved here; OpenDucktor workflow tools are exposed
  // through MCP so role-specific approval handling is intentionally bypassed for this method.
  await context.respondServerRequest(
    session.runtimeId,
    requestId,
    {
      contentItems: [
        {
          type: "inputText",
          text: "OpenDucktor workflow tools are provided through the openducktor MCP server, not Codex dynamic tools.",
        },
      ],
      success: false,
    },
    undefined,
  );
  context.emitSessionEvent(session.threadId, {
    type: "session_error",
    externalSessionId: session.threadId,
    timestamp: new Date().toISOString(),
    message: "Rejected Codex dynamic tool request because OpenDucktor workflow tools must use MCP.",
  });
  return false;
};
