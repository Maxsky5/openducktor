import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { X } from "lucide-react";
import { type ReactElement, useEffect } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionStartupTrace } from "./session-startup-trace";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { useOpenStartupSession } from "./use-open-startup-session";
import { retainStartupPresentations } from "./startup-presentation";

export function SessionStartupStack(): ReactElement | null {
  const connection = useClientConnection();
  const { startupAttempts } = connection;
  const attempts = useStartupAttempts();
  useEffect(
    () => retainStartupPresentations(connection, new Set(attempts.map((attempt) => attempt.id))),
    [attempts, connection],
  );
  useEffect(() => {
    const checkExpiry = () => startupAttempts.expireSuccess();
    document.addEventListener("visibilitychange", checkExpiry);
    window.addEventListener("focus", checkExpiry);
    return () => {
      document.removeEventListener("visibilitychange", checkExpiry);
      window.removeEventListener("focus", checkExpiry);
    };
  }, [startupAttempts]);
  const notifications = attempts.filter((attempt) => attempt.presentation === "notification");
  if (!notifications.length) return null;
  return (
    <DismissableLayerBranch>
      <section
        aria-label="Session startup notifications"
        className="pointer-events-none fixed right-4 top-16 z-[65] flex max-h-[calc(100dvh-6rem)] w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto overscroll-contain pb-4 [&>*]:pointer-events-auto"
      >
        {notifications.map((attempt) => (
          <StartupNotice key={attempt.id} attempt={attempt} />
        ))}
      </section>
    </DismissableLayerBranch>
  );
}

function StartupNotice({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const connection = useClientConnection();
  const { openSession, openError } = useOpenStartupSession(attempt);
  return (
    <Card className="relative bg-card shadow-xl">
      <CardHeader className="pr-12">
        <CardTitle>Session startup</CardTitle>
      </CardHeader>
      <CardContent>
        <SessionStartupTrace attempt={attempt} onOpen={openSession} />
        {openError ? (
          <p role="alert" className="mt-3 break-words text-sm text-destructive">
            {openError}
          </p>
        ) : null}
      </CardContent>
      {!startupIsPending(attempt) ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-2"
          aria-label="Dismiss session startup"
          onClick={() => connection.startupAttempts.dismiss(attempt.id)}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </Card>
  );
}
