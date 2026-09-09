import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { createContext } from "react";

export const AgentChatImageSessionContext = createContext<AgentSessionLiveRef | null>(null);
