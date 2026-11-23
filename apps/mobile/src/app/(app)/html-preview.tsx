import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { HtmlPreviewScreen } from "@/features/session/transcript/html-preview-screen";

export default function HtmlPreviewRoute(): ReactElement {
  return <HtmlPreviewScreen params={useLocalSearchParams()} />;
}
