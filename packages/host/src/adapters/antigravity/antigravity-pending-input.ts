import { randomUUID } from "node:crypto";
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationContentValue,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ToolKind,
} from "@agentclientprotocol/sdk/unstable";
import type {
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest,
  RuntimeApprovalReplyOutcome,
} from "@openducktor/contracts";
import {
  type AntigravityQuestionProperty,
  readAntigravityCommandLine,
  readAntigravityMcpCall,
  readAntigravityQuestionProperties,
  readAntigravityToolInput,
} from "./antigravity-native-payloads";

const MUTATING_KINDS = new Set<ToolKind>(["edit", "delete", "move"]);
const READ_ONLY_KINDS = new Set<ToolKind>(["read", "search", "think", "fetch"]);

export type AntigravityApprovalMutation = NonNullable<
  AgentSessionLivePendingApprovalRequest["mutation"]
>;

/** The ACP tool kind tells whether a request can change files. Other kinds are unknown. */
export const classifyAntigravityPermission = (
  request: RequestPermissionRequest,
): AntigravityApprovalMutation => {
  const kind = request.toolCall.kind ?? "other";
  if (MUTATING_KINDS.has(kind)) return "mutating";
  if (READ_ONLY_KINDS.has(kind)) return "read_only";
  return "unknown";
};

/** True for a call of a tool of the managed OpenDucktor MCP server of the session. */
export const isManagedMcpPermission = (request: RequestPermissionRequest): boolean =>
  readAntigravityMcpCall(request.toolCall)?.managed === true;

/** The native option kind of each reply that OpenDucktor offers. */
const optionKindForOutcome = (
  outcome: RuntimeApprovalReplyOutcome,
): PermissionOption["kind"] | null => {
  switch (outcome) {
    case "approve_once":
      return "allow_once";
    case "reject":
      return "reject_once";
    default:
      return null;
  }
};

/** Builds the pending approval of a native permission request. */
export const toAntigravityApprovalRequest = (
  requestId: string,
  request: RequestPermissionRequest,
): AgentSessionLivePendingApprovalRequest => {
  const toolCall = request.toolCall;
  const kind = toolCall.kind ?? "other";
  const title = toolCall.title ?? toolCall.name ?? "Antigravity tool";
  const mcp = readAntigravityMcpCall(toolCall);
  const approval: AgentSessionLivePendingApprovalRequest = {
    requestId,
    requestType:
      kind === "execute"
        ? "command_execution"
        : MUTATING_KINDS.has(kind)
          ? "file_change"
          : "runtime_tool",
    title,
    mutation: classifyAntigravityPermission(request),
    supportedReplyOutcomes: (["approve_once", "reject"] as const).filter((outcome) =>
      request.options.some((option) => option.kind === optionKindForOutcome(outcome)),
    ),
  };
  const command = readAntigravityCommandLine(toolCall);
  if (kind === "execute" && command) approval.command = { command };
  const paths = (toolCall.locations ?? []).map((location) => location.path);
  if (paths.length > 0) approval.affectedPaths = paths;
  if (mcp) {
    // A global MCP approval names its server, tool, and arguments.
    approval.summary = `${mcp.serverName}: ${mcp.toolName}`;
    approval.tool = { name: `${mcp.serverName}.${mcp.toolName}` };
    if (mcp.args) approval.tool.input = mcp.args;
    return approval;
  }
  const input = readAntigravityToolInput(toolCall);
  // The ACP title names the call, not the tool, and the approval already shows it.
  approval.tool = { name: toolCall.name ?? title };
  if (input) approval.tool.input = input;
  return approval;
};

/** The ACP reply of an approval. Fails when the request did not offer that outcome. */
const toAntigravityPermissionResponse = (
  request: RequestPermissionRequest,
  outcome: RuntimeApprovalReplyOutcome,
): RequestPermissionResponse => {
  const optionKind = optionKindForOutcome(outcome);
  const option = request.options.find((candidate) => candidate.kind === optionKind);
  if (!option) {
    throw new Error(
      `This Antigravity approval does not offer '${outcome}'. Choose one of the offered replies.`,
    );
  }
  return { outcome: { outcome: "selected", optionId: option.optionId } };
};

/** The reply that rejects a request without a user decision, for example for a read-only role. */
export const rejectAntigravityPermission = (
  request: RequestPermissionRequest,
): RequestPermissionResponse => {
  const option = request.options.find((candidate) => candidate.kind === "reject_once");
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
};

/** The reply that approves a request once without a user decision. */
export const allowAntigravityPermissionOnce = (
  request: RequestPermissionRequest,
): RequestPermissionResponse => {
  const option = request.options.find((candidate) => candidate.kind === "allow_once");
  if (!option) {
    throw new Error("Antigravity offered no 'allow once' reply for an OpenDucktor tool call.");
  }
  return { outcome: { outcome: "selected", optionId: option.optionId } };
};

type QuestionField = {
  readonly key: string;
  readonly mode: "single_select" | "multi_select" | "free_text";
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly otherKey: string | undefined;
};

/** The fields of one Antigravity question form, in question order. */
export type AntigravityQuestionForm = {
  readonly request: AgentSessionLivePendingQuestionRequest;
  readonly fields: ReadonlyArray<QuestionField>;
};

const toChoices = (
  entries: AntigravityQuestionProperty["oneOf"],
): Array<{ value: string; label: string }> =>
  (entries ?? []).map((entry) => ({ value: entry.const, label: entry.title || entry.const }));

/**
 * Reads an `elicitation/create` form. Each `qN` field is one question: a string with `oneOf` is
 * single select, an array with `anyOf` items is multi select, and a plain string is free text.
 * `qN_other` is the custom answer of `qN`. Returns null for a form in another shape.
 */
export const toAntigravityQuestionForm = (
  requestId: string,
  request: CreateElicitationRequest,
): AntigravityQuestionForm | null => {
  const properties = readAntigravityQuestionProperties(request);
  const keys = [...properties.keys()]
    .filter((key) => /^q\d+$/.test(key))
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  if (keys.length === 0) return null;
  const fields: QuestionField[] = [];
  const questions: AgentSessionLivePendingQuestionRequest["questions"] = [];
  for (const [index, key] of keys.entries()) {
    const property = properties.get(key);
    if (!property) continue;
    const otherKey = properties.has(`${key}_other`) ? `${key}_other` : undefined;
    const multiOptions = property.type === "array" ? toChoices(property.items?.anyOf) : [];
    const singleOptions = property.type === "string" ? toChoices(property.oneOf) : [];
    if (property.type !== "string" && multiOptions.length === 0) return null;
    const mode: QuestionField["mode"] =
      multiOptions.length > 0
        ? "multi_select"
        : singleOptions.length > 0
          ? "single_select"
          : "free_text";
    const options = mode === "multi_select" ? multiOptions : singleOptions;
    fields.push({ key, mode, options, otherKey });
    const question: AgentSessionLivePendingQuestionRequest["questions"][number] = {
      header: keys.length > 1 ? `Question ${index + 1}` : "Question",
      question: property.title || request.message,
      options: options.map((option) => ({
        label: option.label,
        description: "",
        value: option.value,
      })),
    };
    if (mode === "multi_select") question.multiple = true;
    if (otherKey || mode === "free_text") question.custom = true;
    questions.push(question);
  }
  return {
    request: { requestId, questions, canCancel: true },
    fields,
  };
};

/**
 * The ACP reply of answered questions. Each answer list matches one question. No answer list at
 * all is Cancel Question, which cancels the form. An empty list for one question skips it.
 */
export const toAntigravityQuestionResponse = (
  form: AntigravityQuestionForm,
  answers: ReadonlyArray<ReadonlyArray<string>>,
): CreateElicitationResponse => {
  if (answers.length === 0) return { action: "cancel" };
  const content: Record<string, ElicitationContentValue> = {};
  for (const [index, field] of form.fields.entries()) {
    const answer = (answers[index] ?? []).filter((entry) => entry.trim().length > 0);
    if (answer.length === 0) continue;
    if (field.mode === "free_text") {
      content[field.key] = answer.join("\n");
      continue;
    }
    const known: string[] = [];
    const custom: string[] = [];
    for (const entry of answer) {
      const option = field.options.find(
        (candidate) => candidate.label === entry || candidate.value === entry,
      );
      if (option) known.push(option.value);
      else custom.push(entry);
    }
    if (custom.length > 0 && !field.otherKey) {
      throw new Error(`Question ${index + 1} accepts only its listed choices.`);
    }
    if (field.mode === "multi_select") {
      if (known.length > 0) content[field.key] = known;
    } else if (known[0] !== undefined) {
      content[field.key] = known[0];
    }
    if (custom.length > 0 && field.otherKey) content[field.otherKey] = custom.join("\n");
  }
  return { action: "accept", content };
};

/**
 * Shows a new pending request and waits for the user. When the native request is aborted, a
 * request that is still pending gets the cancelled reply and leaves the live view.
 */
const waitForAntigravityReply = <Response>({
  signal,
  cancelled,
  add,
  remove,
  changed,
}: {
  readonly signal: AbortSignal;
  readonly cancelled: Response;
  /** Stores the pending request with the function that answers it. */
  readonly add: (resolve: (response: Response) => void) => void;
  /** Removes the pending request. False when a reply already removed it. */
  readonly remove: () => boolean;
  /** Publishes the changed pending requests. */
  readonly changed: () => void;
}): Promise<Response> => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  add(resolve);
  signal.addEventListener(
    "abort",
    () => {
      if (!remove()) return;
      resolve(cancelled);
      changed();
    },
    { once: true },
  );
  changed();
  return promise;
};

type PendingApproval = {
  readonly request: RequestPermissionRequest;
  readonly approval: AgentSessionLivePendingApprovalRequest;
  readonly resolve: (response: RequestPermissionResponse) => void;
};

type PendingQuestion = {
  readonly form: AntigravityQuestionForm;
  readonly resolve: (response: CreateElicitationResponse) => void;
};

/**
 * The approvals and questions of one session that wait for the user. Each one answers the exact
 * native request that it shows.
 */
export class AntigravityPendingRequests {
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly questions = new Map<string, PendingQuestion>();

  /** `changed` publishes the session after its pending requests change. */
  constructor(private readonly changed: () => void) {}

  get approvalRequests(): AgentSessionLivePendingApprovalRequest[] {
    return [...this.approvals.values()].map((entry) => entry.approval);
  }

  get questionRequests(): AgentSessionLivePendingQuestionRequest[] {
    return [...this.questions.values()].map((entry) => entry.form.request);
  }

  waitForApproval(
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    const requestId = randomUUID();
    return waitForAntigravityReply<RequestPermissionResponse>({
      signal,
      cancelled: { outcome: { outcome: "cancelled" } },
      add: (resolve) => {
        const approval = toAntigravityApprovalRequest(requestId, request);
        this.approvals.set(requestId, { request, approval, resolve });
      },
      remove: () => this.approvals.delete(requestId),
      changed: this.changed,
    });
  }

  waitForAnswer(
    requestId: string,
    form: AntigravityQuestionForm,
    signal: AbortSignal,
  ): Promise<CreateElicitationResponse> {
    return waitForAntigravityReply<CreateElicitationResponse>({
      signal,
      cancelled: { action: "cancel" },
      add: (resolve) => {
        this.questions.set(requestId, { form, resolve });
      },
      remove: () => this.questions.delete(requestId),
      changed: this.changed,
    });
  }

  approval(requestId: string): AgentSessionLivePendingApprovalRequest {
    return this.pendingApproval(requestId).approval;
  }

  /** Answers a pending approval and returns the tool call of its request. */
  replyApproval(requestId: string, outcome: RuntimeApprovalReplyOutcome): string {
    const pending = this.pendingApproval(requestId);
    const response = toAntigravityPermissionResponse(pending.request, outcome);
    this.approvals.delete(requestId);
    pending.resolve(response);
    return pending.request.toolCall.toolCallId;
  }

  replyQuestion(requestId: string, answers: string[][]): void {
    const pending = this.questions.get(requestId);
    if (!pending) throw new Error(`Antigravity question '${requestId}' is no longer pending.`);
    const response = toAntigravityQuestionResponse(pending.form, answers);
    this.questions.delete(requestId);
    pending.resolve(response);
  }

  /** Closes every pending request without a user reply. */
  cancelAll(): void {
    for (const pending of this.approvals.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.approvals.clear();
    for (const pending of this.questions.values()) pending.resolve({ action: "cancel" });
    this.questions.clear();
  }

  private pendingApproval(requestId: string): PendingApproval {
    const pending = this.approvals.get(requestId);
    if (!pending) throw new Error(`Antigravity approval '${requestId}' is no longer pending.`);
    return pending;
  }
}
