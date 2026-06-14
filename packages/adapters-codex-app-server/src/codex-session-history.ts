import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentModelSelection,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import { codexTurnKey } from "./codex-app-server-requests";
import {
  type CodexTokenUsageTotals,
  codexTurnItemsFromThreadRead,
  toHistoryMessage,
} from "./codex-app-server-transcript";
import type { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexAppServerClient, CodexSessionState } from "./types";

type CodexSessionHistoryRuntime = {
  client: CodexAppServerClient;
  runtimeId: string;
};

type CodexSessionHistoryInput = {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  runtime: CodexSessionHistoryRuntime;
  threadInventory: Pick<
    CodexThreadInventoryReader,
    "ensureThreadReadable" | "loadThreadForHistory" | "readThreadWithTurns"
  >;
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  modelByTurnKey: ReadonlyMap<string, AgentModelSelection>;
  tokenUsageByTurnKey: ReadonlyMap<string, CodexTokenUsageTotals>;
  drainThreadReadTokenUsage: (
    runtimeId: string,
    threadId: string,
  ) => Promise<Map<string, CodexTokenUsageTotals>>;
};

const codexSystemPromptHistoryMessage = ({
  threadId,
  startedAt,
  systemPrompt,
}: {
  threadId: string;
  startedAt: string;
  systemPrompt: string;
}): AgentSessionHistoryMessage | null => {
  const trimmedSystemPrompt = systemPrompt.trim();
  if (trimmedSystemPrompt.length === 0) {
    return null;
  }

  return {
    messageId: `codex-system-prompt:${threadId}`,
    role: "system",
    timestamp: startedAt,
    text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${trimmedSystemPrompt}`,
    parts: [],
  };
};

const codexHistorySystemPrompt = (
  input: LoadAgentSessionHistoryInput,
  session: CodexSessionState | undefined,
): AgentSessionHistoryMessage | null => {
  if (session) {
    return codexSystemPromptHistoryMessage({
      threadId: session.threadId,
      startedAt: session.summary.startedAt,
      systemPrompt: session.systemPrompt,
    });
  }
  if (!input.systemPromptContext) {
    return null;
  }
  return codexSystemPromptHistoryMessage({
    threadId: input.externalSessionId,
    startedAt: input.systemPromptContext.startedAt,
    systemPrompt: input.systemPromptContext.systemPrompt,
  });
};

const projectCodexThreadReadToHistory = ({
  input,
  session,
  response,
  tokenUsageByTurnId,
  eventMapperPipeline,
  modelByTurnKey,
  tokenUsageByTurnKey,
}: {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  response: unknown;
  tokenUsageByTurnId: Map<string, CodexTokenUsageTotals>;
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  modelByTurnKey: ReadonlyMap<string, AgentModelSelection>;
  tokenUsageByTurnKey: ReadonlyMap<string, CodexTokenUsageTotals>;
}): AgentSessionHistoryMessage[] => {
  const projectedHistory = codexTurnItemsFromThreadRead(response)
    .flatMap(({ item, turnId, timestamp, isFinalAgentMessage, turnTiming, model }, index) => {
      const turnModel =
        model ??
        (turnId ? modelByTurnKey.get(codexTurnKey(input.externalSessionId, turnId)) : undefined);
      let finalTokenUsage: CodexTokenUsageTotals | null = null;
      if (isFinalAgentMessage && turnId) {
        finalTokenUsage =
          tokenUsageByTurnId.get(turnId) ??
          tokenUsageByTurnKey.get(codexTurnKey(input.externalSessionId, turnId)) ??
          null;
      }
      const canonicalEvents = eventMapperPipeline.runThreadItem(
        {
          item,
          index,
          ...(timestamp ? { timestamp } : {}),
          ...(isFinalAgentMessage ? { isFinalAgentMessage } : {}),
        },
        {
          source: "thread_read",
          threadId: input.externalSessionId,
          ...(timestamp ? { timestamp } : {}),
        },
      );
      if (canonicalEvents.length > 0) {
        const history = projectCodexCanonicalEventsToHistory(canonicalEvents, turnModel);
        if (isFinalAgentMessage) {
          return history.map((message) =>
            applyFinalAssistantTurnMetadata(message, turnTiming, finalTokenUsage),
          );
        }
        return history;
      }
      const message = toHistoryMessage(
        item,
        `codex-history-${index}`,
        turnModel,
        timestamp ?? undefined,
        isFinalAgentMessage,
        turnTiming,
        finalTokenUsage,
      );
      return message ? [message] : [];
    })
    .filter((message): message is AgentSessionHistoryMessage => Boolean(message));
  const systemPromptHistoryMessage = codexHistorySystemPrompt(input, session);
  return systemPromptHistoryMessage
    ? [systemPromptHistoryMessage, ...projectedHistory]
    : projectedHistory;
};

export const loadCodexSessionHistory = async ({
  input,
  session,
  runtime,
  threadInventory,
  eventMapperPipeline,
  modelByTurnKey,
  tokenUsageByTurnKey,
  drainThreadReadTokenUsage,
}: CodexSessionHistoryInput): Promise<AgentSessionHistoryMessage[]> => {
  const { client, runtimeId } = runtime;
  const preResumeThread = session
    ? null
    : await threadInventory.loadThreadForHistory(client, runtimeId, input);
  const isThreadReadable = session
    ? await threadInventory.ensureThreadReadable(client, runtimeId, input)
    : Boolean(preResumeThread);
  if (!isThreadReadable) {
    return [];
  }
  const response = await threadInventory.readThreadWithTurns(client, input.externalSessionId);
  const tokenUsageByTurnId = await drainThreadReadTokenUsage(runtimeId, input.externalSessionId);
  return projectCodexThreadReadToHistory({
    input,
    session,
    response,
    tokenUsageByTurnId,
    eventMapperPipeline,
    modelByTurnKey,
    tokenUsageByTurnKey,
  });
};
