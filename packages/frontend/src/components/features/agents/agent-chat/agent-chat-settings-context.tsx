import type { ChatSettings } from "@openducktor/contracts";
import { createContext, type ReactElement, type ReactNode, use } from "react";

const AgentChatSettingsContext = createContext<ChatSettings | null>(null);

export function AgentChatSettingsProvider({
  children,
  value,
}: {
  children?: ReactNode;
  value: ChatSettings;
}): ReactElement {
  return (
    <AgentChatSettingsContext.Provider value={value}>{children}</AgentChatSettingsContext.Provider>
  );
}

export function useAgentChatSettings(): ChatSettings {
  const settings = use(AgentChatSettingsContext);
  if (!settings) {
    throw new Error("Agent chat settings are unavailable outside AgentChatSettingsProvider.");
  }
  return settings;
}
