import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentModelSelection,
  type AgentSessionHistoryMessage,
  type AgentSessionTodoItem,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import { codexTurnKey } from "./codex-app-server-requests";
import { isCodexThreadNotLoadedError } from "./codex-app-server-shared";
import {
  type CodexTokenUsageTotals,
  codexTodosFromThreadRead,
  codexTurnItemsFromThreadRead,
  toHistoryMessage,
} from "./codex-app-server-transcript";
import type { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import {
  type CodexForkBoundary,
  codexForkBoundaryHistoryMessage,
  codexForkedFromThreadId,
  resolveCodexForkBoundary,
} from "./codex-fork-boundary";
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
  threadInventory: Pick<CodexThreadInventoryReader, "readThreadHistory" | "readThreadTurnIds">;
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  modelByTurnKey: ReadonlyMap<string, AgentModelSelection>;
  tokenUsageByTurnKey: ReadonlyMap<string, CodexTokenUsageTotals>;
  collectThreadReadTokenUsage: (
    runtimeId: string,
    threadId: string,
  ) => Promise<Map<string, CodexTokenUsageTotals>>;
  rememberTodos: (externalSessionId: string, todos: AgentSessionTodoItem[]) => void;
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
  runtimeId,
  forkBoundary,
}: {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  response: unknown;
  tokenUsageByTurnId: Map<string, CodexTokenUsageTotals>;
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  modelByTurnKey: ReadonlyMap<string, AgentModelSelection>;
  tokenUsageByTurnKey: ReadonlyMap<string, CodexTokenUsageTotals>;
  runtimeId: string;
  forkBoundary: CodexForkBoundary | null;
}): AgentSessionHistoryMessage[] => {
  const forkBoundaryProjection = forkBoundary
    ? {
        ...forkBoundary,
        message: codexForkBoundaryHistoryMessage(forkBoundary),
      }
    : null;
  let didInsertForkBoundary = false;
  const projectedHistory = codexTurnItemsFromThreadRead(response)
    .flatMap(
      (
        {
          item,
          turnIndex,
          turnId,
          timestamp,
          timestampIsApproximate,
          isFinalAgentMessage,
          turnTiming,
          model,
        },
        index,
      ) => {
        const itemOwnerThreadId =
          forkBoundaryProjection && turnIndex < forkBoundaryProjection.beforeTurnIndex
            ? forkBoundaryProjection.parentThreadId
            : input.externalSessionId;
        const turnModel =
          model ??
          (turnId ? modelByTurnKey.get(codexTurnKey(itemOwnerThreadId, turnId)) : undefined);
        let finalTokenUsage: CodexTokenUsageTotals | null = null;
        if (isFinalAgentMessage && turnId) {
          finalTokenUsage =
            tokenUsageByTurnId.get(turnId) ??
            tokenUsageByTurnKey.get(codexTurnKey(itemOwnerThreadId, turnId)) ??
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
            runtimeId,
            threadId: itemOwnerThreadId,
            ...(timestamp ? { timestamp } : {}),
          },
        );
        let history: AgentSessionHistoryMessage[];
        if (canonicalEvents.length > 0) {
          history = projectCodexCanonicalEventsToHistory(canonicalEvents, turnModel);
          if (isFinalAgentMessage) {
            history = history.map((message) =>
              applyFinalAssistantTurnMetadata(message, turnTiming, finalTokenUsage),
            );
          }
        } else {
          const message = toHistoryMessage(
            item,
            `codex-history-${index}`,
            turnModel,
            timestamp ?? undefined,
            isFinalAgentMessage,
            turnTiming,
            finalTokenUsage,
          );
          history = message ? [message] : [];
        }
        if (timestampIsApproximate) {
          history = history.map((message) => ({ ...message, timestampIsApproximate: true }));
        }
        if (
          forkBoundaryProjection &&
          !didInsertForkBoundary &&
          turnIndex >= forkBoundaryProjection.beforeTurnIndex
        ) {
          didInsertForkBoundary = true;
          return [forkBoundaryProjection.message, ...history];
        }
        return history;
      },
    )
    .filter((message): message is AgentSessionHistoryMessage => Boolean(message));
  if (forkBoundaryProjection && !didInsertForkBoundary) {
    projectedHistory.push(forkBoundaryProjection.message);
  }
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
  collectThreadReadTokenUsage,
  rememberTodos,
}: CodexSessionHistoryInput): Promise<AgentSessionHistoryMessage[]> => {
  const { client, runtimeId } = runtime;
  const response = await threadInventory.readThreadHistory(client, {
    ...input,
    allowUnmaterialized: session !== undefined,
  });
  if (!response) {
    return [];
  }
  rememberTodos(input.externalSessionId, codexTodosFromThreadRead(response));
  const forkedFromThreadId = codexForkedFromThreadId(response);
  const parentTurnIdsPromise: Promise<ReadonlySet<string> | null> = forkedFromThreadId
    ? threadInventory.readThreadTurnIds(client, forkedFromThreadId).catch((error: unknown) => {
        if (isCodexThreadNotLoadedError(error)) {
          return null;
        }
        throw error;
      })
    : Promise.resolve(null);
  const [tokenUsageByTurnId, parentTurnIds] = await Promise.all([
    collectThreadReadTokenUsage(runtimeId, input.externalSessionId),
    parentTurnIdsPromise,
  ]);
  const forkBoundary = parentTurnIds ? resolveCodexForkBoundary(response, parentTurnIds) : null;
  return projectCodexThreadReadToHistory({
    input,
    session,
    response,
    tokenUsageByTurnId,
    eventMapperPipeline,
    modelByTurnKey,
    tokenUsageByTurnKey,
    runtimeId,
    forkBoundary,
  });
};
