import { AlertTriangle } from "lucide-react";
import type { TaskConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { ConfirmImpact } from "@/components/features/confirm/confirm-parts";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TaskConfirmContent({ copy }: { copy: TaskConfirmCopy }) {
  return (
    <ConfirmImpact changes={copy.changes} kept={copy.kept} warning={copy.warning}>
      {copy.errors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            {copy.errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            <p className="mt-1">Cancel and reopen this dialog to check again.</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </ConfirmImpact>
  );
}
