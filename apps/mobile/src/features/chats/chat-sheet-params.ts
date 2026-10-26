import { z } from "zod";
import type { RawRouteParams } from "@/navigation/route-params";

const chatSheetParamsSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
});

export type ChatSheetParams = z.infer<typeof chatSheetParamsSchema>;

/** The chat that a rename or archive sheet acts on, or null for a malformed address. */
export const parseChatSheetParams = (params: RawRouteParams): ChatSheetParams | null => {
  const parsed = chatSheetParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
};

const forkChatSheetParamsSchema = chatSheetParamsSchema.extend({ messageId: z.string().min(1) });

export type ForkChatSheetParams = z.infer<typeof forkChatSheetParamsSchema>;

/** The chat and the reply that the Fork Chat sheet forks after, or null for a malformed address. */
export const parseForkChatSheetParams = (params: RawRouteParams): ForkChatSheetParams | null => {
  const parsed = forkChatSheetParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
};
