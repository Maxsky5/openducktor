import type { AgentImageGenerationPart } from "@openducktor/contracts";
import type {
  CodexImageGenerationItem,
  CodexImageGenerationPreparer,
} from "./codex-image-generation";
import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import type { CodexMappingContext } from "./codex-canonical-events";
import { isCodexThreadNotLoadedError } from "./codex-app-server-shared";
import { codexTurnItemsFromThreadRead, toHistoryMessage } from "./codex-app-server-transcript";
import { type CodexThreadItemInput } from "./codex-event-mapper";
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
import type {
  CodexAppServerClient,
  CodexSessionState,
  CodexThreadHistoryReadResponse,
} from "./types";

type CodexSessionHistoryRuntime = {
  client: CodexAppServerClient;
  runtimeId: string;
};

type CodexSessionHistoryInput = {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  runtime: CodexSessionHistoryRuntime;
  prepareImageGenerations?: CodexImageGenerationPreparer | undefined;
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
  preparedImages,
}: {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  response: CodexThreadHistoryReadResponse | undefined;
  eventMapperPipeline: ReturnType<typeof createCodexEventMapperPipeline>;
  runtimeId: string;
  forkBoundary: CodexForkBoundary | null;
  preparedImages: ReadonlyMap<CodexImageGenerationItem, AgentImageGenerationPart> | undefined;
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
          turn,
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
        const threadItemInput: CodexThreadItemInput = {
          item,
          turn,
          index,
        };
        if (item.type === "imageGeneration" && preparedImages) {
          const prepared = preparedImages.get(item);
          if (!prepared)
            throw new Error("Image history preparation returned no result. Reload this session.");
          threadItemInput.preparedImageGeneration = prepared;
        }
        if (timestamp) {
          threadItemInput.timestamp = timestamp;
        }
        if (isFinalAgentMessage) {
          threadItemInput.isFinalAgentMessage = true;
        }
        const mappingContext: CodexMappingContext = {
          source: "thread_read",
          runtimeId,
          threadId: itemOwnerThreadId,
          turnId: turn.id,
        };
        if (timestamp) {
          mappingContext.timestamp = timestamp;
        }
        const canonicalEvents = eventMapperPipeline.runThreadItem(threadItemInput, mappingContext);
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
  prepareImageGenerations,
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
    ? threadInventory.readThreadTurnIds(client, forkedFromThreadId).catch((cause: unknown) => {
        if (isCodexThreadNotLoadedError(cause) && codexForkHistoryIsChildOwned(response)) {
          return null;
        }
        throw cause;
      })
    : Promise.resolve(null);
  const parentTurnIds = await parentTurnIdsPromise;
  const forkBoundary = parentTurnIds ? resolveCodexForkBoundary(response, parentTurnIds) : null;
  let preparedImages: Map<CodexImageGenerationItem, AgentImageGenerationPart> | undefined;
  if (prepareImageGenerations) {
    const images = codexTurnItemsFromThreadRead(response).flatMap(({ item, turn }) =>
      item.type === "imageGeneration"
        ? [{ item, context: { turnId: turn.id, turnStatus: turn.status } }]
        : [],
    );
    const parts = images.length > 0 ? await prepareImageGenerations(images) : [];
    if (parts.length !== images.length)
      throw new Error(
        "Image history preparation returned incomplete results. Reload this session.",
      );
    preparedImages = new Map(
      images.map(({ item, context }, index) => {
        const part = parts[index];
        if (!part || part.itemId !== item.id || part.turnId !== context.turnId)
          throw new Error("Image history preparation returned another image. Reload this session.");
        return [item, part];
      }),
    );
  }
  return projectCodexThreadReadToHistory({
    input,
    session,
    response,
    eventMapperPipeline: createCodexEventMapperPipeline(),
    runtimeId,
    forkBoundary,
    preparedImages,
  });
};
