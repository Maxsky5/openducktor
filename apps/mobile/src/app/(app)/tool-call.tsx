import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { ToolCallScreen } from "@/features/session/transcript/tool-call-screen";

export default function ToolCallRoute(): ReactElement {
  return <ToolCallScreen params={useLocalSearchParams()} />;
}
