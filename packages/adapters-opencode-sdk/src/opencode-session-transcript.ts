import type { OpenCodeClient, SessionInfo, SessionMessageInfo } from "@opencode/client";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
import { z } from "zod";
import { readMessages } from "./opencode-message-projection";

export const OPENCODE_WORKFLOW_INSTRUCTION_KEY = "openducktor.workflow";

/** OpenCode keeps the instruction baseline outside chronological message history. */
export const readOpenCodeTranscript = async (
  client: OpenCodeClient,
  detail: SessionInfo,
): Promise<SessionMessageInfo[]> => {
  const [messages, entries] = await Promise.all([
    readMessages(client, detail.id),
    client.session.instructions.entry.list({ sessionID: detail.id }),
  ]);
  const entry = entries.find((item) => item.key === OPENCODE_WORKFLOW_INSTRUCTION_KEY);
  if (!entry) return messages;
  const prompt = z
    .string()
    .refine((value) => value.trim().length > 0)
    .parse(entry.value);
  return [
    {
      id: `history:system-prompt:${detail.id}`,
      type: "system",
      text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${prompt}`,
      time: { created: detail.time.created },
    },
    ...messages,
  ];
};
