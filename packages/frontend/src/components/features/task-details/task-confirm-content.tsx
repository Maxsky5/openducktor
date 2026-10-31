import { AlertTriangle, Check, Minus } from "lucide-react";
import type { TaskConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TaskConfirmContent({ copy }: { copy: TaskConfirmCopy }) {
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5" aria-label="What changes">
        <h3 className="text-xs font-medium text-muted-foreground">What changes</h3>
        <ul className="flex flex-col gap-2">
          {copy.changes.map((change) => (
            <li key={change} className="flex items-start gap-2.5 text-sm leading-5">
              <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{change}</span>
            </li>
          ))}
        </ul>
      </section>
      {copy.kept.length > 0 ? (
        <section className="flex flex-col gap-2.5" aria-label="What stays">
          <h3 className="text-xs font-medium text-muted-foreground">What stays</h3>
          <ul className="flex flex-col gap-2">
            {copy.kept.map((kept) => (
              <li key={kept} className="flex items-start gap-2.5 text-sm leading-5">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{kept}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Alert variant="warning" role="note">
        <AlertTriangle aria-hidden="true" />
        <AlertDescription>{copy.warning}</AlertDescription>
      </Alert>
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
    </div>
  );
}
