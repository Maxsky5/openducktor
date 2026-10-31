import { useEffect, useRef } from "react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useNavigation } from "expo-router";
import { useOpenStartupSession } from "./use-open-startup-session";
import { useVisibleHandoff } from "./use-visible-handoff";

/** A completed repair has no original command callback left to open its saved session. */
export const useRepairedStartupHandoff = (
  attempt: StartupAttempt | null,
  commandPending = false,
  onInlineReady?: (attemptId: string) => void,
): void => {
  const failedIds = useRef(new Set<string>());
  const { startupAttempts } = useClientConnection();
  const navigation = useNavigation();
  const openSession = useOpenStartupSession();
  const visibleHandoff = useVisibleHandoff();
  useEffect(() => {
    if (attempt?.status.phase === "failed") failedIds.current.add(attempt.id);
    if (
      attempt &&
      startupAttempts.isReadyForHandoff(attempt.id) &&
      (attempt.presentation === "dialog" || (attempt.presentation === "inline" && onInlineReady)) &&
      failedIds.current.has(attempt.id) &&
      !commandPending
    )
      void visibleHandoff(() => {
        const current = startupAttempts.getAttempt(attempt.id);
        if (
          !navigation.isFocused() ||
          !startupAttempts.isReadyForHandoff(attempt.id) ||
          current?.presentation !== attempt.presentation
        )
          return;
        if (current.presentation === "inline") onInlineReady?.(current.id);
        else openSession(current.id);
      });
  }, [
    attempt,
    commandPending,
    navigation,
    onInlineReady,
    openSession,
    startupAttempts,
    visibleHandoff,
  ]);
};
