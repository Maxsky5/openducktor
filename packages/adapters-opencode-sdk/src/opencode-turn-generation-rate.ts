import type {
  OpenCodeClient,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStepStarted,
} from "@opencode/client";

/** OpenCode before 2.1 stored the event time as the request start. */
export const openCodeStepStartedAt = (event: SessionStepStarted): number =>
  event.data.started ?? event.created;

export const isStoppedOpenCodeReply = (
  message: SessionMessageInfo,
): message is SessionMessageAssistant & { time: { completed: number } } =>
  message.type === "assistant" &&
  message.finish === "stop" &&
  !message.error &&
  message.time.completed !== undefined;

export const completedOpenCodeReplies = (
  messages: Iterable<SessionMessageInfo>,
  executionEnds?: ReadonlySet<string>,
): Set<string> => {
  const completed = new Set<string>();
  let finalReply: string | undefined;
  for (const message of messages) {
    if (message.type === "assistant")
      finalReply = isStoppedOpenCodeReply(message) ? message.id : undefined;
    if (message.type === "idle") {
      if (message.outcome === "succeeded" && finalReply) completed.add(finalReply);
      finalReply = undefined;
    } else if (executionEnds?.has(message.id)) finalReply = undefined;
  }
  return completed;
};

const measureTurn = (
  messages: readonly SessionMessageInfo[],
  replyIndex: number,
  { legacy, unmarkedExecutionEnds, pendingSteps }: OpenCodeTurnRateOptions,
): number | undefined => {
  // SessionTurn.tokensPerSecond starts after the first input in a marked turn
  // and after the nearest input in legacy history.
  let boundaryIndex = -1;
  for (let index = replyIndex - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.type === "idle" || unmarkedExecutionEnds?.has(message.id)) {
      boundaryIndex = Math.max(boundaryIndex, index);
      break;
    }
    if (message.type !== "user" && message.type !== "synthetic") continue;
    boundaryIndex = index;
    if (legacy) break;
  }

  let tokens = 0;
  let milliseconds = 0;
  for (let index = boundaryIndex + 1; index <= replyIndex; index++) {
    const message = messages[index]!;
    if (message.type !== "assistant") continue;
    if (pendingSteps?.has(message.id)) return;
    const streamStart = message.time.firstToken ?? message.time.created;
    const streamEnd = message.time.streamed;
    if (!Number.isFinite(streamStart) || streamEnd === undefined || !Number.isFinite(streamEnd))
      return;
    tokens += (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0);
    milliseconds += Math.max(0, streamEnd - streamStart);
  }
  if (tokens <= 0 || milliseconds <= 0 || !Number.isFinite(milliseconds)) return;
  const rate = tokens / (milliseconds / 1_000);
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
};

export type OpenCodeTurnRateEvidence = {
  unmarkedExecutionEnds: ReadonlySet<string>;
  unmarkedSuccesses: ReadonlySet<string>;
  copiedPrefix?: string | undefined;
};

type OpenCodeTurnRateOptions = Partial<OpenCodeTurnRateEvidence> & {
  legacy?: boolean;
  pendingSteps?: ReadonlySet<string>;
};

export const openCodeTurnGenerationRates = (
  messages: readonly SessionMessageInfo[],
  options: OpenCodeTurnRateOptions,
): Map<string, number> => {
  const { copiedPrefix } = options;
  const copiedEnd =
    copiedPrefix && messages.findLast((message) => message.id.startsWith(copiedPrefix));
  const turnOptions = copiedEnd
    ? {
        ...options,
        unmarkedExecutionEnds: new Set([...(options.unmarkedExecutionEnds ?? []), copiedEnd.id]),
      }
    : options;
  const completedReplies = completedOpenCodeReplies(messages, turnOptions.unmarkedExecutionEnds);
  const rates = new Map<string, number>();
  for (const [index, message] of messages.entries()) {
    const unmarked = options.unmarkedSuccesses?.has(message.id);
    if (!unmarked && !completedReplies.has(message.id)) continue;
    const rate = measureTurn(
      messages,
      index,
      unmarked ? { ...turnOptions, legacy: true } : turnOptions,
    );
    if (rate !== undefined) rates.set(message.id, rate);
  }
  return rates;
};

type RateSession = Pick<SessionInfo, "id" | "fork">;

const isPossibleCopiedStep = (session: RateSession, id: string): boolean =>
  session.fork !== undefined && /^msg_.+_\d+$/.test(id);

export const openCodeTurnRateCandidates = (
  session: RateSession,
  messages: readonly SessionMessageInfo[],
  observing = false,
): Map<string, SessionMessageAssistant> => {
  const candidates = new Map<string, SessionMessageAssistant>();
  const firstIdle = messages.findIndex((message) => message.type === "idle");
  const lastIdle = messages.findLastIndex((message) => message.type === "idle");
  const lastPrefixStep = messages.findLastIndex(
    (message, index) => message.type === "assistant" && (firstIdle < 0 || index < firstIdle),
  );
  for (const [index, message] of messages.entries()) {
    if (message.type !== "assistant") continue;
    // The last step before the first idle may belong to an earlier, markerless execution.
    const stoppedWithStream =
      isStoppedOpenCodeReply(message) && message.time.streamed !== undefined;
    const possibleLegacyEnd =
      message.time.firstToken === undefined &&
      (index < lastPrefixStep ||
        (index === lastPrefixStep && (firstIdle < 0 ? observing : stoppedWithStream)));
    const stoppedInOpenTail = !observing && index > lastIdle && stoppedWithStream;
    if (possibleLegacyEnd || stoppedInOpenTail || isPossibleCopiedStep(session, message.id))
      candidates.set(message.id, message);
  }
  return candidates;
};

const readRateLog = async (
  client: OpenCodeClient,
  session: RateSession,
  candidates: ReadonlyMap<string, SessionMessageAssistant>,
  signal?: AbortSignal,
) => {
  const executions = new Map<string, { idleId: string; stopped: boolean }>();
  let copiedPrefix: string | undefined;

  let step:
    | { id: string; completedAt: number | undefined; matchesStoppedReply: boolean }
    | undefined;
  for await (const event of client.experimental.session.log(
    { sessionID: session.id, follow: false },
    signal ? { signal } : undefined,
  )) {
    switch (event.type) {
      case "session.forked":
        if (
          session.fork &&
          event.data.parentID === session.fork.sessionID &&
          event.data.boundary.type === session.fork.boundary.type &&
          event.data.boundary.messageID === session.fork.boundary.messageID
        )
          copiedPrefix = event.id.replace(/^evt_/, "msg_") + "_";
        break;
      case "session.step.started": {
        const id = event.data.assistantMessageID;
        executions.delete(id);
        const candidate = candidates.get(id);
        step = undefined;
        if (!candidate) break;
        const startedAt = openCodeStepStartedAt(event);
        const { created, completed: completedAt } = candidate.time;
        // Older restarts kept the original creation time in the saved step.
        const matchesStart =
          event.data.started === undefined
            ? created <= startedAt && (completedAt === undefined || startedAt <= completedAt)
            : created === startedAt;
        if (matchesStart) step = { id, completedAt, matchesStoppedReply: false };
        break;
      }
      case "session.step.ended":
        if (step && step.id === event.data.assistantMessageID)
          step.matchesStoppedReply =
            event.data.finish === "stop" && event.created === step.completedAt;
        break;
      case "session.step.failed":
        if (step?.id === event.data.assistantMessageID) step.matchesStoppedReply = false;
        break;
      case "session.execution.failed":
      case "session.execution.succeeded":
      case "session.execution.interrupted":
        if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown")
          break;
        if (step)
          executions.set(step.id, {
            idleId: event.id.replace(/^evt_/, "msg_"),
            stopped: event.type === "session.execution.succeeded" && step.matchesStoppedReply,
          });
        step = undefined;
        break;
      case "session.revert.committed":
        step = undefined;
        break;
      case "log.synced":
        return { executions, copiedPrefix };
    }
  }
  throw new Error("OpenCode ended the session log before its sync marker. Retry reading history.");
};

export const readOpenCodeRateEvidence = async (
  client: OpenCodeClient,
  session: RateSession,
  messages: SessionMessageInfo[],
  readMessages: () => Promise<SessionMessageInfo[]>,
  candidates = openCodeTurnRateCandidates(session, messages),
  signal?: AbortSignal,
): Promise<{ messages: SessionMessageInfo[]; rates: OpenCodeTurnRateEvidence }> => {
  const unmarkedExecutionEnds = new Set<string>();
  const unmarkedSuccesses = new Set<string>();
  const rates: OpenCodeTurnRateEvidence = { unmarkedExecutionEnds, unmarkedSuccesses };
  if (candidates.size === 0) return { messages, rates };

  const { executions, copiedPrefix } = await readRateLog(client, session, candidates, signal);
  if (!copiedPrefix && [...candidates.keys()].some((id) => isPossibleCopiedStep(session, id)))
    throw new Error(
      "OpenCode did not confirm the copied history boundary. Retry reading the conversation.",
    );
  if (copiedPrefix) rates.copiedPrefix = copiedPrefix;

  const afterLastIdle = messages.findLastIndex((message) => message.type === "idle") + 1;
  const successInOpenTail = messages
    .slice(afterLastIdle)
    .some((message) => executions.get(message.id)?.stopped);

  // The terminal event and its idle record commit together on servers that store the marker.
  const settled = successInOpenTail ? await readMessages() : messages;
  const idleIds = new Set<string>();
  for (const message of settled) if (message.type === "idle") idleIds.add(message.id);

  for (const saved of settled) {
    if (saved.type !== "assistant") continue;
    const execution = executions.get(saved.id);
    const original = candidates.get(saved.id);
    if (!execution || !original || saved.time.created !== original.time.created) continue;
    if (idleIds.has(execution.idleId)) continue;
    const sameCompletion = saved.time.completed === original.time.completed;
    // Starting a new step can fill the completion time of a previously interrupted row.
    if (sameCompletion || original.time.completed === undefined)
      unmarkedExecutionEnds.add(saved.id);
    if (execution.stopped && sameCompletion) unmarkedSuccesses.add(saved.id);
  }
  return { messages: settled, rates };
};
