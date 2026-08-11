import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { type ComponentProps, createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import { resolveAgentChatRuntimePresentation } from "./agent-chat-runtime-presentation";
import { AgentChatSettingsProvider } from "./agent-chat-settings-context";
import {
  AgentSessionTranscriptDialogContext,
  type AgentSessionTranscriptDialogContextValue,
} from "./agent-session-transcript-dialog-context";
import type { ParentSessionRuntimeContext } from "./subagent-session-key";

export const LONG_TRANSCRIPT_SAMPLE =
  "supercalifragilisticexpialidocioussupercalifragilisticexpialidocious";

export const createDefaultTestChatSettings = () => createChatSettingsFixture();

const DEFAULT_RUNTIME_PRESENTATION: ComponentProps<
  typeof AgentChatMessageCard
>["runtimePresentation"] = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
  runtimeKind: "opencode",
});

const CODEX_RUNTIME_PRESENTATION: ComponentProps<
  typeof AgentChatMessageCard
>["runtimePresentation"] = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
  runtimeKind: "codex",
});

export const createDefaultTestSessionIdentity = (): ParentSessionRuntimeContext => ({
  runtimeKind: "opencode",
  workingDirectory: "/repo",
});

type AgentChatMessageCardTestProps = Omit<
  ComponentProps<typeof AgentChatMessageCard>,
  "sessionIdentity" | "runtimePresentation"
> & {
  chatSettings?: ReturnType<typeof createDefaultTestChatSettings>;
  sessionIdentity?: ParentSessionRuntimeContext | null;
  transcriptDialog?: AgentSessionTranscriptDialogContextValue;
  runtimePresentation?: ComponentProps<typeof AgentChatMessageCard>["runtimePresentation"];
};

export const createCodexMessageCardTestProps = (): Pick<
  AgentChatMessageCardTestProps,
  "sessionIdentity" | "runtimePresentation"
> => ({
  sessionIdentity: {
    ...createDefaultTestSessionIdentity(),
    runtimeKind: "codex",
  },
  runtimePresentation: CODEX_RUNTIME_PRESENTATION,
});

export const createMessageCardElement = ({
  chatSettings = createDefaultTestChatSettings(),
  sessionIdentity = createDefaultTestSessionIdentity(),
  transcriptDialog,
  runtimePresentation = DEFAULT_RUNTIME_PRESENTATION,
  ...props
}: AgentChatMessageCardTestProps) => {
  const card = createElement(AgentChatMessageCard, {
    sessionIdentity,
    runtimePresentation,
    ...props,
  });
  const cardWithTranscriptContext = transcriptDialog
    ? createElement(AgentSessionTranscriptDialogContext.Provider, { value: transcriptDialog }, card)
    : card;

  return createElement(
    AgentChatSettingsProvider,
    { value: chatSettings },
    cardWithTranscriptContext,
  );
};

export const renderMessageCardToHtml = async (
  element: ReturnType<typeof createMessageCardElement>,
): Promise<string> => {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
};
