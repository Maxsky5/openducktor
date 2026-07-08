import type { PullRequestReviewCheck } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { TaskExecutionCiCheckCard } from "./task-execution-ci-check-card";

export function TaskExecutionCiChecksList({
  checks,
}: {
  checks: PullRequestReviewCheck[];
}): ReactElement {
  if (checks.length === 0) {
    return <p className="text-sm text-muted-foreground">No checks reported.</p>;
  }

  return (
    <div className="space-y-2">
      {checks.map((check) => {
        const card = <TaskExecutionCiCheckCard check={check} />;
        if (!check.url) {
          return <div key={check.name}>{card}</div>;
        }

        return (
          <a
            key={check.name}
            href={check.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {card}
          </a>
        );
      })}
    </div>
  );
}
