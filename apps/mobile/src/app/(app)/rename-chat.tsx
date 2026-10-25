import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseChatSheetParams } from "@/features/chats/chat-sheet-params";
import { RenameChatSheet } from "@/features/chats/rename-chat-sheet";

export default function RenameChatRoute(): ReactElement {
  return <RenameChatSheet params={parseChatSheetParams(useLocalSearchParams())} />;
}
