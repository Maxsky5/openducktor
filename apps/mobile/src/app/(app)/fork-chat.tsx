import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { parseForkChatSheetParams } from "@/features/chats/chat-sheet-params";
import { ForkChatSheet } from "@/features/chats/fork-chat-sheet";

export default function ForkChatRoute(): ReactElement {
  return <ForkChatSheet params={parseForkChatSheetParams(useLocalSearchParams())} />;
}
