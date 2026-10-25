import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { SessionScreen } from "@/features/session/session-screen";

export default function SessionRoute(): ReactElement {
  return <SessionScreen params={useLocalSearchParams()} />;
}
