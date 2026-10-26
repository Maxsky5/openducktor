import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import { type ReactElement, useEffect, useRef } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { useStartupAttempts } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { Button } from "@/components/ui/button";
import { SessionStartupTrace } from "./session-startup-trace";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";

export function InlineSessionStartup({
  repoPath,
  taskId,
  role,
}: {
  repoPath: string | null;
  taskId: string | null | undefined;
  role: AgentRole | null;
}): ReactElement | null {
  return (
    <InlineSessionStartupOwner
      key={JSON.stringify([repoPath, taskId, role])}
      repoPath={repoPath}
      taskId={taskId}
      role={role}
    />
  );
}

function InlineSessionStartupOwner({
  repoPath,
  taskId,
  role,
}: {
  repoPath: string | null;
  taskId: string | null | undefined;
  role: AgentRole | null;
}): ReactElement | null {
  const connection = useClientConnection();
  const attempts = useStartupAttempts();
  const active = useSessionViewActive();
  const matching = attempts.filter(
    (attempt) =>
      attempt.presentation === "inline" &&
      attempt.origin.repoPath === repoPath &&
      attempt.origin.scope.kind === "task" &&
      attempt.origin.scope.taskId === taskId &&
      attempt.origin.scope.role === role,
  );
  const owned = useRef(new Set<string>()).current;
  for (const attempt of matching) owned.add(attempt.id);
  useEffect(() => {
    if (!active) {
      for (const id of owned) connection.startupAttempts.continueInBackground(id);
      owned.clear();
    }
  }, [active, connection, owned]);
  useEffect(
    () => () => {
      for (const id of owned) {
        if (connection.startupAttempts.getAttempt(id)?.presentation === "inline")
          connection.startupAttempts.continueInBackground(id);
      }
      owned.clear();
    },
    [connection, owned],
  );
  if (!active || !matching.length) return null;
  return (
    <div className="flex max-h-[55dvh] shrink-0 flex-col gap-3 overflow-y-auto border-b border-border bg-card p-4">
      {matching.map((attempt) => (
        <div key={attempt.id} className="flex min-h-0 flex-col gap-3">
          <SessionStartupTrace attempt={attempt} />
          {!startupIsPending(attempt) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-end"
              onClick={() => connection.startupAttempts.dismiss(attempt.id)}
            >
              Dismiss
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
