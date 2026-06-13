import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentModelSelection,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import { codexTurnKey } from "./codex-app-server-requests";
import type { CodexThreadSnapshot } from "./codex-app-server-threads";
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
  rememberHistoryOnlyIdleThreadLoad: (
    input: LoadAgentSessionHistoryInput,
    preResumeThread: CodexThreadSnapshot,
  ) => void;
};

const codexSystemPromptHistoryMessage = (
  session: CodexSessionState,
): AgentSessionHistoryMessage | null => {
  const systemPrompt = session.systemPrompt.trim();
  if (systemPrompt.length === 0) {
    return null;
  }

  return {
    messageId: `codex-system-prompt:${session.threadId}`,
    role: "system",
    timestamp: session.summary.startedAt,
    text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${systemPrompt}`,
    parts: [],
  };
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
  const systemPromptHistoryMessage = session ? codexSystemPromptHistoryMessage(session) : null;
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
  rememberHistoryOnlyIdleThreadLoad,
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
  if (preResumeThread) {
    rememberHistoryOnlyIdleThreadLoad(input, preResumeThread);
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
