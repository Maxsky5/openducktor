import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { ArchiveChatSheet } from "@/features/chats/archive-chat-sheet";
import { parseChatSheetParams } from "@/features/chats/chat-sheet-params";

export default function ArchiveChatRoute(): ReactElement {
  return <ArchiveChatSheet params={parseChatSheetParams(useLocalSearchParams())} />;
}
