import type { AgentSessionForkPoint } from "@openducktor/contracts";
import { createContext } from "react";

export type AgentChatForkActions = {
  disabledReason: string | null;
  isPending: (point: AgentSessionForkPoint) => boolean;
  onFork: (point: AgentSessionForkPoint) => void;
};

export const AgentChatForkActionsContext = createContext<AgentChatForkActions | null>(null);
