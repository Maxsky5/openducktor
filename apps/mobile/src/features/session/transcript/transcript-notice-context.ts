import type { AgentChatTranscriptNotice } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { createContext } from "react";

/**
 * The notice above the first message. The top edge cell of each list reads it, so a new notice
 * renders that cell again and leaves the list items as they are.
 */
export const TranscriptNoticeContext = createContext<AgentChatTranscriptNotice | null>(null);
