import { randomUUID } from "node:crypto";
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk/unstable";
import type {
  AgentSessionContextUsage,
  RuntimeApprovalReplyOutcome,
  SlashCommandCatalog,
} from "@openducktor/contracts";
import {
  type AntigravityLiveSession,
  type AntigravitySessionHost,
  publishInBackground,
} from "./antigravity-live-session";
import {
  allowAntigravityPermissionOnce,
  classifyAntigravityPermission,
  isManagedMcpPermission,
  rejectAntigravityPermission,
  toAntigravityApprovalRequest,
  toAntigravityPermissionResponse,
  toAntigravityQuestionForm,
  toAntigravityQuestionResponse,
} from "./antigravity-pending-input";
import { acceptAntigravityTurnStart } from "./antigravity-session-turns";

/**
 * Answers a native permission request of a session. Calls of the managed OpenDucktor MCP server
 * pass, because that server registers only the tools of the session role. A read-only role
 * refuses file changes. Every other request waits for the user.
 */
export const handleAntigravityPermission = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  params: RequestPermissionRequest,
  signal: AbortSignal,
): Promise<RequestPermissionResponse> => {
  acceptAntigravityTurnStart(session);
  if (isManagedMcpPermission(params))
    return Promise.resolve(allowAntigravityPermissionOnce(params));
  if (session.readOnly && classifyAntigravityPermission(params) === "mutating") {
    publishInBackground(host, session, [
      ...session.transcript.markToolDeclined(params.toolCall.toolCallId),
      {
        type: "session_policy_notice",
        externalSessionId: session.ref.externalSessionId,
        timestamp: host.now(),
        messageId: `${session.ref.externalSessionId}:read-only:${params.toolCall.toolCallId}`,
        message: "OpenDucktor refused a file change, because this workflow role is read-only.",
      },
    ]);
    return Promise.resolve(rejectAntigravityPermission(params));
  }
  const requestId = randomUUID();
  const { promise, resolve } = Promise.withResolvers<RequestPermissionResponse>();
  session.pendingApprovals.set(requestId, {
    request: params,
    approval: toAntigravityApprovalRequest(requestId, params),
    resolve,
  });
  signal.addEventListener(
    "abort",
    () => {
      if (!session.pendingApprovals.delete(requestId)) return;
      resolve({ outcome: { outcome: "cancelled" } });
      publishInBackground(host, session, []);
    },
    { once: true },
  );
  publishInBackground(host, session, []);
  return promise;
};

/** Shows an `elicitation/create` form as a question request, or declines a form it cannot show. */
export const handleAntigravityElicitation = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  params: CreateElicitationRequest,
  signal: AbortSignal,
): Promise<CreateElicitationResponse> => {
  acceptAntigravityTurnStart(session);
  const requestId = randomUUID();
  const form = toAntigravityQuestionForm(requestId, params);
  if (!form) {
    publishInBackground(host, session, [
      {
        type: "session_policy_notice",
        externalSessionId: session.ref.externalSessionId,
        timestamp: host.now(),
        messageId: `${session.ref.externalSessionId}:question:${requestId}`,
        message:
          "Antigravity asked a question in a form that OpenDucktor cannot show, so OpenDucktor declined it.",
      },
    ]);
    return Promise.resolve({ action: "decline" });
  }
  const { promise, resolve } = Promise.withResolvers<CreateElicitationResponse>();
  session.pendingQuestions.set(requestId, { form, resolve });
  signal.addEventListener(
    "abort",
    () => {
      if (!session.pendingQuestions.delete(requestId)) return;
      resolve({ action: "cancel" });
      publishInBackground(host, session, []);
    },
    { once: true },
  );
  publishInBackground(host, session, []);
  return promise;
};

/** Replies to the exact native request of a pending approval. */
export const replyAntigravityApproval = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  requestId: string,
  outcome: RuntimeApprovalReplyOutcome,
): Promise<void> => {
  const pending = session.pendingApprovals.get(requestId);
  if (!pending) {
    throw new Error(`Antigravity approval '${requestId}' is no longer pending.`);
  }
  const response = toAntigravityPermissionResponse(pending.request, outcome);
  session.pendingApprovals.delete(requestId);
  const events =
    outcome === "reject"
      ? session.transcript.markToolDeclined(pending.request.toolCall.toolCallId)
      : [];
  pending.resolve(response);
  return host.publish(session, events);
};

/** Replies to the exact native request of a pending question. */
export const replyAntigravityQuestion = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  requestId: string,
  answers: string[][],
): Promise<void> => {
  const pending = session.pendingQuestions.get(requestId);
  if (!pending) {
    throw new Error(`Antigravity question '${requestId}' is no longer pending.`);
  }
  const response = toAntigravityQuestionResponse(pending.form, answers);
  session.pendingQuestions.delete(requestId);
  pending.resolve(response);
  return host.publish(session, []);
};

/** True for an update that shows that the runtime works on the turn. */
const isAntigravityTurnContent = (update: SessionUpdate): boolean => {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "tool_call":
    case "tool_call_update":
    case "plan":
      return true;
    default:
      return false;
  }
};

/** True for an update that changes the snapshot of a session without a transcript event. */
const changesAntigravitySnapshot = (update: SessionUpdate): boolean =>
  update.sessionUpdate === "usage_update" || update.sessionUpdate === "session_info_update";

/**
 * The command list of a session. Antigravity can list a name twice, for example a built-in command
 * and a skill with the same name, and it runs the first one, so the list keeps the first entry.
 */
const toSlashCommandCatalog = (
  update: Extract<SessionUpdate, { sessionUpdate: "available_commands_update" }>,
): SlashCommandCatalog => {
  const seen = new Set<string>();
  const commands: SlashCommandCatalog["commands"] = [];
  for (const command of update.availableCommands) {
    const name = command.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const hint = command.input && "hint" in command.input ? command.input.hint.trim() : "";
    const description = command.description.trim();
    const descriptor: SlashCommandCatalog["commands"][number] = {
      id: `antigravity:${name}`,
      trigger: name,
      title: `/${name}`,
      source: "command",
      hints: hint ? [hint] : [],
    };
    if (description) descriptor.description = description;
    commands.push(descriptor);
  }
  return { commands };
};

/**
 * Applies the session state of an update: context use, title, and the command list. Returns the
 * new command list when the update carries one.
 */
const applyAntigravitySessionState = (
  session: AntigravityLiveSession,
  update: SessionUpdate,
): SlashCommandCatalog | null => {
  switch (update.sessionUpdate) {
    case "usage_update": {
      const usage: AgentSessionContextUsage = {
        totalTokens: update.used,
        contextWindow: update.size,
      };
      if (session.model) {
        usage.providerId = session.model.providerId;
        usage.modelId = session.model.modelId;
        if (session.model.variant) usage.variant = session.model.variant;
      }
      session.contextUsage = usage;
      return null;
    }
    case "session_info_update":
      // A Workspace Session keeps the title that OpenDucktor saved.
      if (update.title && session.sessionScope.kind !== "repository") session.title = update.title;
      return null;
    case "available_commands_update":
      return toSlashCommandCatalog(update);
    default:
      return null;
  }
};

/**
 * Applies an update of a session that this runtime holds. A loading session keeps the replay. A
 * live session publishes what changed. Both keep the last command list for the setup publish.
 */
export const applyAntigravitySessionUpdate = (
  host: AntigravitySessionHost,
  session: AntigravityLiveSession,
  update: SessionUpdate,
): void => {
  if (session.loading) {
    session.transcript.applyUpdate(update, "replay");
    session.latestSlashCommands =
      applyAntigravitySessionState(session, update) ?? session.latestSlashCommands;
    return;
  }
  if (isAntigravityTurnContent(update)) acceptAntigravityTurnStart(session);
  const slashCommands = applyAntigravitySessionState(session, update);
  if (slashCommands) session.latestSlashCommands = slashCommands;
  const events = session.transcript.applyUpdate(update, "live");
  if (events.length === 0 && !slashCommands && !changesAntigravitySnapshot(update)) return;
  publishInBackground(
    host,
    session,
    events,
    slashCommands ? { slashCommands: { ref: session.ref, catalog: slashCommands } } : undefined,
  );
};
