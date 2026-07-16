import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import { isCodexThreadNotLoadedError } from "./codex-app-server-shared";
import { codexTurnItemsFromThreadRead, toHistoryMessage } from "./codex-app-server-transcript";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import {
  type CodexForkBoundary,
  codexForkBoundaryHistoryMessage,
  codexForkedFromThreadId,
  codexForkHistoryIsChildOwned,
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
  eventMapperPipeline,
  runtimeId,
  forkBoundary,
}: {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  response: unknown;
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
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
        const turnModel = model;
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
              applyFinalAssistantTurnMetadata(message, turnTiming, null),
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
            null,
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
}: CodexSessionHistoryInput): Promise<AgentSessionHistoryMessage[]> => {
  const { client, runtimeId } = runtime;
  const response = await threadInventory.readThreadHistory(client, {
    ...input,
    allowUnmaterialized: session !== undefined,
  });
  if (!response) {
    return [];
  }
  const forkedFromThreadId = codexForkedFromThreadId(response);
  const parentTurnIdsPromise: Promise<ReadonlySet<string> | null> = forkedFromThreadId
    ? threadInventory.readThreadTurnIds(client, forkedFromThreadId).catch((error: unknown) => {
        if (isCodexThreadNotLoadedError(error) && codexForkHistoryIsChildOwned(response)) {
          return null;
        }
        throw error;
      })
    : Promise.resolve(null);
  const parentTurnIds = await parentTurnIdsPromise;
  const forkBoundary = parentTurnIds ? resolveCodexForkBoundary(response, parentTurnIds) : null;
  return projectCodexThreadReadToHistory({
    input,
    session,
    response,
    eventMapperPipeline: createCodexEventMapperPipeline(),
    runtimeId,
    forkBoundary,
  });
};
