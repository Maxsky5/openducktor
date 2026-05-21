import type { AgentEvent } from "@openducktor/core";
import {
  extractTurnId,
  isMutatingCodexRequest,
  parseQuestionRequest,
  READ_ONLY_ROLES,
  toApprovalRequest,
} from "./codex-app-server-requests";
import { type ActiveCodexTurn, CODEX_USER_INPUT_REQUEST_METHOD } from "./codex-app-server-shared";
import { requireNormalizedCodexToolInvocation } from "./codex-tool-normalizer";
import type {
  CodexServerRequestRecord,
  CodexServerRequestResponder,
  CodexSessionState,
} from "./types";

export type CodexServerRequestHandlerContext = {
  respondServerRequest: CodexServerRequestResponder;
  pendingApprovalsByRequestId: Map<
    string,
    { runtimeId: string; request: import("@openducktor/core").AgentPendingApprovalRequest }
  >;
  pendingApprovalIdsBySessionId: Map<string, Set<string>>;
  pendingQuestionsByRequestId: Map<
    string,
    {
      runtimeId: string;
      threadId: string;
      request: import("@openducktor/core").AgentPendingQuestionRequest;
      questionIds: string[];
      input: Record<string, unknown>;
    }
  >;
  pendingQuestionIdsBySessionId: Map<string, Set<string>>;
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
    context.pendingQuestionsByRequestId.set(parsed.request.requestId, {
      runtimeId: session.runtimeId,
      threadId: session.threadId,
      request: parsed.request,
      questionIds: parsed.questionIds,
      input: questionInput,
    });
    const requestIds = context.pendingQuestionIdsBySessionId.get(session.threadId) ?? new Set();
    requestIds.add(parsed.request.requestId);
    context.pendingQuestionIdsBySessionId.set(session.threadId, requestIds);
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
    if (session.role && READ_ONLY_ROLES.has(session.role) && isMutatingCodexRequest(rawRequest)) {
      await context.respondServerRequest(
        session.runtimeId,
        requestId,
        {
          approved: false,
          outcome: "reject",
          message: `Codex request '${rawRequest.method}' was rejected because role '${session.role}' is read-only.`,
        },
        undefined,
      );
      context.emitSessionEvent(session.threadId, {
        type: "session_error",
        externalSessionId: session.threadId,
        timestamp: new Date().toISOString(),
        message: `Rejected mutating Codex request '${rawRequest.method}' for read-only role '${session.role}'.`,
      });
      return false;
    }

    const approval = toApprovalRequest(rawRequest, session.role ?? "build");
    context.pendingApprovalsByRequestId.set(approval.requestId, {
      runtimeId: session.runtimeId,
      request: approval,
    });
    const requestIds = context.pendingApprovalIdsBySessionId.get(session.threadId) ?? new Set();
    requestIds.add(approval.requestId);
    context.pendingApprovalIdsBySessionId.set(session.threadId, requestIds);
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
