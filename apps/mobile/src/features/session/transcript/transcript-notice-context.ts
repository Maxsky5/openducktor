import type { AgentChatTranscriptNotice } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { createContext } from "react";

/**
 * The notice above the first message. The top edge cell of each list reads it, so a new notice
 * renders that cell again and leaves the list items as they are.
 */
export const TranscriptNoticeContext = createContext<AgentChatTranscriptNotice | null>(null);

/**
 * The active inline startup attempt rendered at the top of the transcript, or null.
 */
export const TranscriptStartupContext = createContext<string | null>(null);

/**
 * True only for the currently visible FlashList slot. Standby slots render a plain spacer in
 * TopEdge so startup cards never duplicate across mounted slots.
 */
export const TranscriptShownContext = createContext<boolean>(true);
