import { createContext } from "react";
import type { TranscriptModelCache } from "./agent-chat-transcript-model-cache";

export const AgentChatTranscriptCacheContext = createContext<TranscriptModelCache | null>(null);
