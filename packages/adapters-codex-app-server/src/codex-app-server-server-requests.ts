import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentEvent,
  normalizeOdtWorkflowToolName,
} from "@openducktor/core";
import { codexServerRequestKey } from "./codex-app-server-approvals";
import {
  classifyCodexRequestMutation,
  codexApprovalResponseForRequest,
  extractThreadIdFromParams,
  extractTurnId,
  parseQuestionRequest,
  toApprovalRequest,
  toMcpElicitationApprovalRequest,
} from "./codex-app-server-requests";
import { type ActiveCodexTurn, CODEX_USER_INPUT_REQUEST_METHOD } from "./codex-app-server-shared";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import { READ_ONLY_ROLES } from "./codex-session-policy";
import {
  type CodexSubagentLinkState,
  type CodexSubagentRoute,
  codexSubagentRouteEventFields,
} from "./codex-subagent-link-state";
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
  subagents: CodexSubagentLinkState;
  sessionForThreadId(threadId: string): CodexSessionState | undefined;
  bindActiveTurnId(activeTurn: ActiveCodexTurn, turnId: string, startedAtMs?: number): boolean;
  flushQueuedUserMessagesLater(activeTurn: ActiveCodexTurn): void;
  emitSessionEvent(externalSessionId: string, event: AgentEvent): void;
  emitRoutedRequestEvent?(targetSession: CodexSessionState, event: AgentEvent): void;
};

type RequestRouteContext = {
  ownerThreadId: string;
  ownerSession?: CodexSessionState;
  policySession: CodexSessionState;
  runtimeId: string;
  route: CodexSubagentRoute | null;
};

const resolveRequestRouteContext = (
  context: CodexServerRequestHandlerContext,
  session: CodexSessionState,
  rawRequest: CodexServerRequestRecord,
): RequestRouteContext => {
  const ownerThreadId = extractThreadIdFromParams(rawRequest.params) ?? session.threadId;
  const ownerSession =
    context.sessionForThreadId(ownerThreadId) ??
    (ownerThreadId === session.threadId ? session : undefined);
  const route = context.subagents.routeForChild(ownerThreadId, session.runtimeId);
  if (route?.runtimeId && route.runtimeId !== session.runtimeId) {
    throw new Error(
      `Cannot handle Codex server request for thread '${ownerThreadId}' from runtime '${session.runtimeId}' because its subagent route belongs to runtime '${route.runtimeId}'.`,
    );
  }
  const parentSession = route
    ? (context.sessionForThreadId(route.parentExternalSessionId) ??
      (route.parentExternalSessionId === session.threadId ? session : undefined))
    : undefined;
  if (ownerSession && ownerSession.runtimeId !== session.runtimeId) {
    throw new Error(
      `Cannot handle Codex server request for thread '${ownerThreadId}' from runtime '${session.runtimeId}' because the owner session belongs to runtime '${ownerSession.runtimeId}'.`,
    );
  }
  if (parentSession && parentSession.runtimeId !== session.runtimeId) {
    throw new Error(
      `Cannot handle Codex server request for thread '${ownerThreadId}' from runtime '${session.runtimeId}' because the parent session belongs to runtime '${parentSession.runtimeId}'.`,
    );
  }
  const policySession = parentSession ?? ownerSession ?? session;
  return {
    ownerThreadId,
    ...(ownerSession ? { ownerSession } : {}),
    policySession,
    runtimeId: ownerSession?.runtimeId ?? policySession.runtimeId,
    route,
  };
};

const emitPendingEvent = (
  context: CodexServerRequestHandlerContext,
  routeContext: RequestRouteContext,
  event: AgentEvent,
  targetSession?: CodexSessionState,
): void => {
  if (targetSession && context.emitRoutedRequestEvent) {
    context.emitRoutedRequestEvent(targetSession, {
      ...event,
      externalSessionId: routeContext.ownerThreadId,
      ...codexSubagentRouteEventFields(routeContext.route),
    });
    return;
  }
  if (routeContext.ownerSession) {
    context.emitSessionEvent(routeContext.ownerThreadId, {
      ...event,
      externalSessionId: routeContext.ownerThreadId,
      ...codexSubagentRouteEventFields(routeContext.route),
    });
  }
  if (
    routeContext.route &&
    context.sessionForThreadId(routeContext.route.parentExternalSessionId)
  ) {
    context.emitSessionEvent(routeContext.route.parentExternalSessionId, {
      ...event,
      externalSessionId: routeContext.route.parentExternalSessionId,
      ...codexSubagentRouteEventFields(routeContext.route),
    });
  }
};

export const handleCodexServerRequest = async (
  context: CodexServerRequestHandlerContext,
  session: CodexSessionState,
  rawRequest: CodexServerRequestRecord,
  handledRequestKeys: Set<string>,
  requestReceivedAtMs?: number,
  targetSession?: CodexSessionState,
): Promise<boolean> => {
  const requestId = rawRequest.id;
  const requestKey = requestId !== undefined ? codexServerRequestKey(requestId) : undefined;
  if (requestKey && handledRequestKeys.has(requestKey)) {
    return false;
  }

  const markHandled = (): void => {
    if (requestKey) {
      handledRequestKeys.add(requestKey);
    }
  };
  const forgetHandled = (): void => {
    if (requestKey) {
      handledRequestKeys.delete(requestKey);
    }
  };
  const runWhileHandled = (operation: () => void, rollback?: () => void): void => {
    markHandled();
    try {
      operation();
    } catch (error) {
      rollback?.();
      forgetHandled();
      throw error;
    }
  };

  if (typeof rawRequest.method !== "string" || rawRequest.method.trim().length === 0) {
    throw new Error("Codex app-server server request is missing method.");
  }

  const routeContext = resolveRequestRouteContext(context, session, rawRequest);
  if (!routeContext.ownerSession && !routeContext.route) {
    throw new Error(
      `Cannot handle Codex server request '${rawRequest.method}' for thread '${routeContext.ownerThreadId}' from session '${session.threadId}' because there is no known session or subagent route for the request owner.`,
    );
  }
  const requestTurnId = extractTurnId(rawRequest.params);
  const activeTurn =
    context.activeTurnsBySessionId.get(routeContext.ownerThreadId) ??
    (routeContext.ownerThreadId === routeContext.policySession.threadId
      ? context.activeTurnsBySessionId.get(routeContext.policySession.threadId)
      : undefined);
  if (
    requestTurnId &&
    activeTurn &&
    context.bindActiveTurnId(activeTurn, requestTurnId, requestReceivedAtMs)
  ) {
    context.flushQueuedUserMessagesLater(activeTurn);
  }

  const mcpElicitationApproval = toMcpElicitationApprovalRequest(rawRequest);
  if (mcpElicitationApproval) {
    if (requestId === undefined) {
      throw new Error("Codex MCP elicitation request is missing an id.");
    }

    const roleRejection = odtWorkflowToolRoleRejection(
      routeContext.policySession,
      mcpElicitationApproval.metadata?.serverName,
      mcpElicitationApproval.tool?.name,
    );
    if (roleRejection) {
      markHandled();
      try {
        await context.respondServerRequest(
          routeContext.runtimeId,
          requestId,
          codexApprovalResponseForRequest({
            outcome: "reject",
            request: rawRequest,
            message: `Codex MCP request '${mcpElicitationApproval.tool?.name}' was rejected because ${roleRejection}.`,
          }),
          undefined,
        );
      } catch (error) {
        forgetHandled();
        throw error;
      }
      context.emitSessionEvent(routeContext.policySession.threadId, {
        type: "session_error",
        externalSessionId: routeContext.policySession.threadId,
        timestamp: new Date().toISOString(),
        message: `Rejected Codex MCP request '${mcpElicitationApproval.tool?.name}' because ${roleRejection}.`,
      });
      return false;
    }

    let registeredRequestId: string | null = null;
    runWhileHandled(
      () => {
        const registration = context.pendingInput.addApproval({
          runtimeId: routeContext.runtimeId,
          threadId: routeContext.ownerThreadId,
          nativeRequest: {
            id: requestId,
            method: rawRequest.method,
            ...(rawRequest.params !== undefined ? { params: rawRequest.params } : {}),
          },
          request: mcpElicitationApproval,
          ...(routeContext.route ? { route: routeContext.route } : {}),
        });
        if (!registration.isNew) {
          return;
        }
        registeredRequestId = registration.entry.request.requestId;
        emitPendingEvent(
          context,
          routeContext,
          {
            ...registration.entry.request,
            type: "approval_required",
            externalSessionId: routeContext.ownerThreadId,
            timestamp: new Date().toISOString(),
          },
          targetSession,
        );
      },
      () => {
        if (registeredRequestId) {
          context.pendingInput.resolveApproval(registeredRequestId, routeContext.runtimeId);
        }
      },
    );
    return true;
  }

  if (rawRequest.method === CODEX_USER_INPUT_REQUEST_METHOD) {
    const parsed = parseQuestionRequest(rawRequest);
    if (parsed.threadId !== routeContext.ownerThreadId) {
      throw new Error(
        `Codex question request thread '${parsed.threadId}' does not match request owner '${routeContext.ownerThreadId}'.`,
      );
    }
    if (activeTurn && context.bindActiveTurnId(activeTurn, parsed.turnId, requestReceivedAtMs)) {
      context.flushQueuedUserMessagesLater(activeTurn);
    }
    const questionInput = {
      questions: parsed.request.questions,
    };
    let registeredRequestId: string | null = null;
    runWhileHandled(
      () => {
        const registration = context.pendingInput.addQuestion({
          runtimeId: routeContext.runtimeId,
          threadId: routeContext.ownerThreadId,
          nativeRequest: {
            id: parsed.serverRequestId,
            method: rawRequest.method,
            ...(rawRequest.params !== undefined ? { params: rawRequest.params } : {}),
          },
          request: parsed.request,
          questionIds: parsed.questionIds,
          input: questionInput,
          ...(routeContext.route ? { route: routeContext.route } : {}),
        });
        if (!registration.isNew) {
          return;
        }
        registeredRequestId = registration.entry.request.requestId;
        const question = registration.entry.request;
        const questionToolCallId = question.requestId;
        emitPendingEvent(
          context,
          routeContext,
          {
            ...question,
            type: "question_required",
            externalSessionId: routeContext.ownerThreadId,
            timestamp: new Date().toISOString(),
          },
          targetSession,
        );
        emitPendingEvent(
          context,
          routeContext,
          {
            type: "assistant_part",
            externalSessionId: routeContext.ownerThreadId,
            timestamp: new Date().toISOString(),
            part: requireNormalizedCodexToolInvocation({
              messageId: `codex-question-${questionToolCallId}`,
              partId: `codex-question-${questionToolCallId}`,
              callId: questionToolCallId,
              rawToolName: "request_user_input",
              status: "running",
              input: questionInput,
              metadata: {
                codexServerRequest: true,
                questions: parsed.request.questions,
              },
            }),
          },
          targetSession,
        );
      },
      () => {
        if (registeredRequestId) {
          context.pendingInput.resolveQuestion(registeredRequestId, routeContext.runtimeId);
        }
      },
    );
    return true;
  }

  if (rawRequest.method !== "item/tool/call") {
    if (requestId === undefined) {
      throw new Error(`Codex app-server server request '${rawRequest.method}' is missing an id.`);
    }
    const requestMutation = classifyCodexRequestMutation(rawRequest);
    if (
      routeContext.policySession.role &&
      READ_ONLY_ROLES.has(routeContext.policySession.role) &&
      requestMutation === "read_only"
    ) {
      markHandled();
      try {
        await context.respondServerRequest(
          routeContext.runtimeId,
          requestId,
          codexApprovalResponseForRequest({ outcome: "approve_once", request: rawRequest }),
          undefined,
        );
      } catch (error) {
        forgetHandled();
        throw error;
      }
      return false;
    }

    const parsedApproval = toApprovalRequest(rawRequest);
    let registeredRequestId: string | null = null;
    runWhileHandled(
      () => {
        const registration = context.pendingInput.addApproval({
          runtimeId: routeContext.runtimeId,
          threadId: routeContext.ownerThreadId,
          nativeRequest: {
            id: requestId,
            method: rawRequest.method,
            ...(rawRequest.params !== undefined ? { params: rawRequest.params } : {}),
          },
          request: parsedApproval,
          ...(routeContext.route ? { route: routeContext.route } : {}),
        });
        if (!registration.isNew) {
          return;
        }
        registeredRequestId = registration.entry.request.requestId;
        emitPendingEvent(
          context,
          routeContext,
          {
            ...registration.entry.request,
            type: "approval_required",
            externalSessionId: routeContext.ownerThreadId,
            timestamp: new Date().toISOString(),
          },
          targetSession,
        );
      },
      () => {
        if (registeredRequestId) {
          context.pendingInput.resolveApproval(registeredRequestId, routeContext.runtimeId);
        }
      },
    );
    return true;
  }

  if (requestId === undefined) {
    throw new Error("Codex app-server tool request is missing an id.");
  }

  // Dynamic Codex tool calls are never approved here; OpenDucktor workflow tools are exposed
  // through MCP so role-specific approval handling is intentionally bypassed for this method.
  markHandled();
  try {
    await context.respondServerRequest(
      routeContext.runtimeId,
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
  } catch (error) {
    forgetHandled();
    throw error;
  }
  context.emitSessionEvent(routeContext.policySession.threadId, {
    type: "session_error",
    externalSessionId: routeContext.policySession.threadId,
    timestamp: new Date().toISOString(),
    message: "Rejected Codex dynamic tool request because OpenDucktor workflow tools must use MCP.",
  });
  return false;
};
