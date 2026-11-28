import type {
  OpenCodeClient,
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

const measureTurn = (
  messages: readonly SessionMessageInfo[],
  replyIndex: number,
  legacy: boolean,
  unmarkedExecutionEnds?: ReadonlySet<string>,
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
};

export type OpenCodeTurnRateOptions = Partial<OpenCodeTurnRateEvidence> & { legacy?: boolean };

export const openCodeTurnGenerationRates = (
  messages: readonly SessionMessageInfo[],
  completedReplies: ReadonlySet<string>,
  { legacy = false, unmarkedExecutionEnds, unmarkedSuccesses }: OpenCodeTurnRateOptions,
): Map<string, number> => {
  const rates = new Map<string, number>();
  for (const [index, message] of messages.entries()) {
    let rate: number | undefined;
    if (completedReplies.has(message.id))
      rate = measureTurn(messages, index, legacy, unmarkedExecutionEnds);
    if (unmarkedSuccesses?.has(message.id))
      rate = measureTurn(messages, index, true, unmarkedExecutionEnds) ?? rate;
    if (rate !== undefined) rates.set(message.id, rate);
  }
  return rates;
};

/** Some saved turns predate idle records, even in a session that now has them. */
const unmarkedReplies = (messages: readonly SessionMessageInfo[], includeOpenTail: boolean) => {
  const candidates = new Map<string, SessionMessageAssistant>();
  const firstIdle = messages.findIndex((message) => message.type === "idle");
  const lastIdle = messages.findLastIndex((message) => message.type === "idle");
  let previousAssistant: SessionMessageAssistant | undefined;
  for (const [index, message] of messages.entries()) {
    if (index === firstIdle && previousAssistant) candidates.delete(previousAssistant.id);
    if (message.type !== "assistant") continue;
    previousAssistant = message;
    if (
      (firstIdle < 0 || index < firstIdle || (includeOpenTail && index > lastIdle)) &&
      isStoppedOpenCodeReply(message) &&
      measureTurn(messages, index, true) !== undefined
    )
      candidates.set(message.id, message);
  }
  return candidates;
};

// First-token timing was added after idle records. A step without it in the prefix may belong
// to an older execution. Its terminal event still bounds the next turn, even without stream timing.
const possibleLegacyExecutionEnds = (
  messages: readonly SessionMessageInfo[],
  includeOpenTail: boolean,
) => {
  const candidates = new Map<string, SessionMessageAssistant>();
  let lastAssistant: string | undefined;
  let hasIdle = false;
  for (const message of messages) {
    if (message.type === "idle") {
      hasIdle = true;
      break;
    }
    if (message.type !== "assistant") continue;
    lastAssistant = message.id;
    if (message.time.firstToken === undefined) candidates.set(message.id, message);
  }
  // The final step already has a stored boundary, or has no later step to bound in history.
  if ((hasIdle || !includeOpenTail) && lastAssistant !== undefined)
    candidates.delete(lastAssistant);
  return candidates;
};

const readUnmarkedOpenCodeExecutions = async (
  client: OpenCodeClient,
  sessionID: string,
  candidates: ReadonlyMap<string, SessionMessageAssistant>,
) => {
  const executions = new Map<string, "stopped" | "ended">();
  if (candidates.size === 0) return executions;

  let step:
    | { id: string; completedAt: number | undefined; matchesStoppedReply: boolean }
    | undefined;
  for await (const event of client.experimental.session.log({ sessionID, follow: false })) {
    switch (event.type) {
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
          executions.set(
            step.id,
            event.type === "session.execution.succeeded" && step.matchesStoppedReply
              ? "stopped"
              : "ended",
          );
        step = undefined;
        break;
      case "session.revert.committed":
        step = undefined;
        break;
      case "log.synced":
        return executions;
    }
  }
  throw new Error("OpenCode ended the session log before its sync marker. Retry reading history.");
};

export const readOpenCodeLegacyExecutionEnds = async (
  client: OpenCodeClient,
  sessionID: string,
  messages: readonly SessionMessageInfo[],
): Promise<ReadonlySet<string>> =>
  new Set(
    (
      await readUnmarkedOpenCodeExecutions(
        client,
        sessionID,
        possibleLegacyExecutionEnds(messages, true),
      )
    ).keys(),
  );

export const readOpenCodeHistoryRateEvidence = async (
  client: OpenCodeClient,
  sessionID: string,
  messages: SessionMessageInfo[],
  readMessages: () => Promise<SessionMessageInfo[]>,
): Promise<{ messages: SessionMessageInfo[]; rates: OpenCodeTurnRateEvidence }> => {
  const measurableReplies = unmarkedReplies(messages, true);
  const candidates = new Map([
    ...possibleLegacyExecutionEnds(messages, false),
    ...measurableReplies,
  ]);
  const executions = await readUnmarkedOpenCodeExecutions(client, sessionID, candidates);
  const unmarkedExecutionEnds = new Set<string>();
  const unmarkedSuccesses = new Set<string>();
  const rates = { unmarkedExecutionEnds, unmarkedSuccesses };
  if (executions.size === 0) return { messages, rates };

  const afterLastIdle = messages.findLastIndex((message) => message.type === "idle") + 1;
  const successInOpenTail = messages
    .slice(afterLastIdle)
    .some(
      (message) => executions.get(message.id) === "stopped" && measurableReplies.has(message.id),
    );

  // OpenCode commits the idle record with the durable event. Read after the log when a
  // success falls in the open tail, where the first read could have missed that commit.
  const settled = successInOpenTail ? await readMessages() : messages;
  const legacyEnds = possibleLegacyExecutionEnds(settled, false);
  const legacyReplies = unmarkedReplies(settled, false);
  for (const [id, outcome] of executions) {
    const saved = legacyEnds.get(id) ?? legacyReplies.get(id);
    const original = candidates.get(id);
    if (!saved || !original || saved.time.created !== original.time.created) continue;
    const sameCompletion = saved.time.completed === original.time.completed;
    // OpenCode may complete an interrupted row when it starts the next step.
    if (legacyEnds.has(id) && (sameCompletion || original.time.completed === undefined))
      unmarkedExecutionEnds.add(id);
    if (outcome === "stopped" && sameCompletion && legacyReplies.has(id)) unmarkedSuccesses.add(id);
  }
  return { messages: settled, rates };
};
