import type { AgentImageGenerationPart } from "@openducktor/contracts";
import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  AgentRuntimeQueryError,
  type AgentSessionHistoryMessage,
  type AgentModelSelection,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { applyFinalAssistantTurnMetadata } from "./codex-app-server-history";
import { isCodexThreadNotLoadedError } from "./codex-app-server-shared";
import { codexTurnItemsFromThreadRead, toHistoryMessage } from "./codex-app-server-transcript";
import type { CodexMappingContext } from "./codex-canonical-events";
import type { CodexThreadItemInput } from "./codex-event-mapper";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";
import {
  type CodexForkBoundary,
  codexForkBoundaryHistoryMessage,
  codexForkedFromThreadId,
  codexForkHistoryIsChildOwned,
  resolveCodexForkBoundary,
} from "./codex-fork-boundary";
import { projectCodexCanonicalEventsToHistory } from "./codex-history-projector";
import {
  codexSubagentDisplayDetails,
  codexThreadSnapshot,
  type CodexSubagentDisplayDetails,
} from "./codex-app-server-threads";
import type {
  CodexImageGenerationItem,
  CodexImageGenerationPreparer,
} from "./codex-image-generation";
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
  readRunningTurnModel: (threadId: string, turnId: string) => AgentModelSelection | undefined;
};

export const loadCodexSessionHistory = async ({
  input,
  session,
  runtime,
  threadInventory,
  prepareImageGenerations,
  readRunningTurnModel,
}: CodexSessionHistoryInput): Promise<AgentSessionHistoryMessage[]> => {
  if (session?.firstTurnHistory) {
    const promptMessage = systemPromptMessage(input, session);
    const history = session.firstTurnHistory.snapshot();
    return promptMessage ? [promptMessage, ...history] : history;
  }
  const { client, runtimeId } = runtime;
  const response = await threadInventory.readThreadHistory(client, input);
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
        ? [
            {
              item,
              context: {
                turnId: turn.id,
                turnStatus: turn.status,
                ref: {
                  repoPath: input.repoPath,
                  workingDirectory: input.workingDirectory,
                  externalSessionId: input.externalSessionId,
                  runtimeKind: "codex" as const,
                },
              },
            },
          ]
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
  const history = toHistory({
    input,
    session,
    response,
    runtimeId,
    forkBoundary,
    preparedImages,
    readRunningTurnModel,
  });
  const subagentDetails = await loadSubagentDetails(client, input, response, forkBoundary);
  for (const message of history) {
    for (const part of message.parts) {
      if (part.kind !== "subagent" || !part.externalSessionId) continue;
      const details = subagentDetails.get(part.externalSessionId);
      if (!part.agent && details?.agent) part.agent = details.agent;
      if (!part.description && details?.description) part.description = details.description;
    }
  }
  return history;
};

const loadSubagentDetails = async (
  client: CodexAppServerClient,
  input: LoadAgentSessionHistoryInput,
  response: CodexThreadHistoryReadResponse,
  forkBoundary: CodexForkBoundary | null,
): Promise<Map<string, CodexSubagentDisplayDetails>> => {
  const parentsByChild = new Map<string, string>();
  for (const { item, turnIndex } of codexTurnItemsFromThreadRead(response)) {
    if (item.type !== "subAgentActivity" || item.kind !== "started") continue;
    const parentThreadId =
      forkBoundary && turnIndex < forkBoundary.beforeTurnIndex
        ? forkBoundary.parentThreadId
        : input.externalSessionId;
    parentsByChild.set(item.agentThreadId, parentThreadId);
  }
  const entries = await Promise.all(
    [...parentsByChild].map(async ([childThreadId, parentThreadId]) => {
      const result = await client.threadRead({ threadId: childThreadId, includeTurns: false });
      const thread = codexThreadSnapshot(result.thread);
      // Inherited children keep their source directory when a fork uses another worktree.
      const hasWrongDirectory =
        parentThreadId === input.externalSessionId && thread.cwd !== input.workingDirectory;
      if (
        thread.id !== childThreadId ||
        hasWrongDirectory ||
        thread.parentThreadId !== parentThreadId ||
        (thread.subAgentSource && thread.subAgentSource.parentThreadId !== parentThreadId)
      ) {
        throw new AgentRuntimeQueryError(
          "scope_mismatch",
          `Codex subagent metadata for '${childThreadId}' does not match its parent and working directory. Reload the matching session.`,
        );
      }
      return [childThreadId, codexSubagentDisplayDetails(thread)] as const;
    }),
  );
  return new Map(entries);
};

const systemPromptMessage = (
  input: LoadAgentSessionHistoryInput,
  session: CodexSessionState | undefined,
): AgentSessionHistoryMessage | null => {
  const prompt =
    session && session.systemPrompt.trim().length > 0
      ? {
          threadId: session.threadId,
          startedAt: session.summary.startedAt,
          systemPrompt: session.systemPrompt,
        }
      : input.systemPromptContext && {
          threadId: input.externalSessionId,
          startedAt: input.systemPromptContext.startedAt,
          systemPrompt: input.systemPromptContext.systemPrompt,
        };
  if (!prompt) return null;
  const text = prompt.systemPrompt.trim();
  if (!text) return null;
  return {
    messageId: `codex-system-prompt:${prompt.threadId}`,
    role: "system",
    timestamp: prompt.startedAt,
    text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${text}`,
    parts: [],
  };
};

const toHistory = ({
  input,
  session,
  response,
  runtimeId,
  forkBoundary,
  preparedImages,
  readRunningTurnModel,
}: {
  input: LoadAgentSessionHistoryInput;
  session: CodexSessionState | undefined;
  response: CodexThreadHistoryReadResponse;
  runtimeId: string;
  forkBoundary: CodexForkBoundary | null;
  preparedImages: ReadonlyMap<CodexImageGenerationItem, AgentImageGenerationPart> | undefined;
  readRunningTurnModel: CodexSessionHistoryInput["readRunningTurnModel"];
}): AgentSessionHistoryMessage[] => {
  const eventMapperPipeline = createCodexEventMapperPipeline();
  let boundaryAdded = false;
  const projectedHistory = codexTurnItemsFromThreadRead(response).flatMap(
    (
      { item, turnIndex, turn, timestamp, timestampIsApproximate, isFinalAgentMessage, turnTiming },
      index,
    ) => {
      const itemOwnerThreadId =
        forkBoundary && turnIndex < forkBoundary.beforeTurnIndex
          ? forkBoundary.parentThreadId
          : input.externalSessionId;
      const model = readRunningTurnModel(itemOwnerThreadId, turn.id);
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
        history = projectCodexCanonicalEventsToHistory(canonicalEvents, model);
        if (isFinalAgentMessage) {
          history = history.map((message) =>
            applyFinalAssistantTurnMetadata(message, turnTiming, null),
          );
        }
      } else {
        const message = toHistoryMessage(
          item,
          model,
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
      if (forkBoundary && !boundaryAdded && turnIndex >= forkBoundary.beforeTurnIndex) {
        boundaryAdded = true;
        return [codexForkBoundaryHistoryMessage(forkBoundary), ...history];
      }
      return history;
    },
  );
  if (forkBoundary && !boundaryAdded) {
    projectedHistory.push(codexForkBoundaryHistoryMessage(forkBoundary));
  }
  const promptMessage = systemPromptMessage(input, session);
  return promptMessage ? [promptMessage, ...projectedHistory] : projectedHistory;
};
