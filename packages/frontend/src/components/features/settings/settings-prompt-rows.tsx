import { plural } from "@openducktor/frontend-core/lib/plural";
import { ChevronRight, CircleAlert } from "lucide-react";
import { type ReactElement, type RefObject, useId, useLayoutEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PromptRowData, PromptWorkflow } from "./settings-prompt-owners";
import { PromptStatusBadges, promptStatusMarks } from "./settings-prompt-status-badges";

/**
 * The row of the item that the user just left gets the focus again, so the user keeps the place.
 * A filter can hide the row, so the list gets the focus instead.
 */
export function useRestoreRowFocus(
  listRef: RefObject<HTMLElement | null>,
  focusKey: string | null,
): void {
  useLayoutEffect(() => {
    if (!focusKey) return;
    const row = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-focus-key]") ?? []),
    ].find((element) => element.dataset.focusKey === focusKey);
    (row ?? listRef.current)?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center" });
  }, [listRef, focusKey]);
}

/** The classes of a row button of a list card. */
export const ROW_BUTTON_CLASS_NAME =
  "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

/** The classes of a list card of rows. */
export const ROW_LIST_CLASS_NAME =
  "divide-y divide-border overflow-hidden rounded-md border border-border bg-card";

export function RowChevron(): ReactElement {
  return (
    <ChevronRight
      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      aria-hidden="true"
    />
  );
}

function PromptRow({
  row,
  ownerId,
  disabled,
  onOpen,
}: {
  row: PromptRowData;
  /** The heading of the owner of the row, in search results where rows of owners mix. */
  ownerId?: string | undefined;
  disabled: boolean;
  onOpen: (key: string) => void;
}): ReactElement {
  const { template, label, icon: Icon, status, roles } = row;
  const labelId = useId();
  const detailId = useId();
  const rolesId = useId();
  const badgesId = useId();
  return (
    <li>
      <button
        type="button"
        data-focus-key={template.key}
        aria-labelledby={labelId}
        aria-describedby={[
          ownerId ?? "",
          detailId,
          roles.length > 0 ? rolesId : "",
          promptStatusMarks(status).length > 0 ? badgesId : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        className={ROW_BUTTON_CLASS_NAME}
        onClick={() => onOpen(template.key)}
      >
        {/* A role prompt shows its role. A workflow prompt shows its roles in chips instead. */}
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={labelId} className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
          <span id={detailId} className="truncate text-xs text-muted-foreground">
            {template.description || template.usage}
          </span>
        </span>
        {roles.length > 0 ? (
          <span id={rolesId} className="hidden shrink-0 items-center gap-1 @xl/prompts:flex">
            <span className="sr-only">Sent to</span>
            {roles.map(({ label, icon: RoleIcon }) => (
              <Badge
                key={label}
                variant="outline"
                className="gap-1 border-border text-muted-foreground"
              >
                <RoleIcon className="size-3" aria-hidden="true" />
                {label}
              </Badge>
            ))}
          </span>
        ) : null}
        <PromptStatusBadges id={badgesId} status={status} />
        <RowChevron />
      </button>
    </li>
  );
}

/** A list of prompt rows. */
export function PromptRows({
  className,
  rows,
  ownerId,
  disabled,
  onOpen,
}: {
  className?: string;
  rows: readonly PromptRowData[];
  ownerId?: string | undefined;
  disabled: boolean;
  onOpen: (key: string) => void;
}): ReactElement {
  return (
    <ul className={cn(ROW_LIST_CLASS_NAME, className)}>
      {rows.map((row) => (
        <PromptRow
          key={row.template.key}
          row={row}
          ownerId={ownerId}
          disabled={disabled}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}

/** The error count of a workflow. It never shrinks, so a narrow screen still shows it. */
export function WorkflowErrors({
  id,
  workflow,
}: {
  id?: string;
  workflow: PromptWorkflow;
}): ReactElement | null {
  if (workflow.errorCount === 0) return null;
  return (
    <Badge id={id} variant="danger" className="shrink-0 gap-1">
      <CircleAlert className="size-3" aria-hidden="true" />
      {plural(workflow.errorCount, "error")}
    </Badge>
  );
}
