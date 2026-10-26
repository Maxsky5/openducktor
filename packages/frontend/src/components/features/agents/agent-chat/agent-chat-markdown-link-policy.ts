import type { MarkdownLinkPolicy } from "@/components/ui/markdown-link-policy";
import { isChatLocalDestination } from "@openducktor/frontend-core/sessions/messages/chat-file-link";
import { ChatMarkdownLink } from "./agent-chat-markdown-link";

export const CHAT_MARKDOWN_LINK_POLICY: MarkdownLinkPolicy = {
  anchor: ChatMarkdownLink,
  handlesDestination: isChatLocalDestination,
};
