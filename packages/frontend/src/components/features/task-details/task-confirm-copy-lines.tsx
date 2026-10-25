import type { TaskConfirmCopyLine } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import type { ReactElement } from "react";

const lineClassName = (line: TaskConfirmCopyLine): string | undefined => {
  if (line.error) return "text-destructive-muted";
  return line.emphasis ? "font-medium" : undefined;
};

/** The lines of a task confirmation, in their order. */
export function TaskConfirmCopyLines({
  lines,
}: {
  lines: readonly TaskConfirmCopyLine[];
}): ReactElement {
  return (
    <>
      {lines.map((line) => (
        <p key={line.text} className={lineClassName(line)}>
          {line.text}
        </p>
      ))}
    </>
  );
}
