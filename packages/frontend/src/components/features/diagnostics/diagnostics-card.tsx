import {
  Cable,
  CircleAlert,
  Database,
  FolderTree,
  GitBranch,
  History,
  type LucideIcon,
} from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import type {
  DiagnosticsCheckKey,
  DiagnosticsCheckModel,
  DiagnosticsDetailModel,
} from "./diagnostics-panel-model";
import { DiagnosticsStatusPill } from "./diagnostics-status";

type DiagnosticsGroupProps = {
  title: string;
  description: string;
  children: ReactNode;
};

/** One labeled group of the panel, for example Host or Workspace. */
export function DiagnosticsGroup({
  title,
  description,
  children,
}: DiagnosticsGroupProps): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3
          id={headingId}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {title}
        </h3>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

type DiagnosticsCardProps = {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A bordered card. Its children are rows that the card separates with dividers. */
export function DiagnosticsCard({
  title,
  children,
  className,
}: DiagnosticsCardProps): ReactElement {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-xs",
        "divide-y divide-border",
        className,
      )}
    >
      {title ? (
        <div className="bg-muted/40 px-4 py-2.5">
          <div className="min-w-0 text-sm font-medium text-foreground">{title}</div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A secondary fact under a row title. A path keeps its full text in the tooltip. */
export function DiagnosticsDetail({ detail }: { detail: DiagnosticsDetailModel }): ReactElement {
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{detail.label}</span>
      <span
        className={cn("min-w-0 truncate", detail.isPath && "font-mono text-[11px]")}
        title={detail.value}
      >
        {detail.value}
      </span>
    </p>
  );
}

type DiagnosticsCalloutProps = {
  tone: "danger" | "warning";
  title?: string;
  children: ReactNode;
};

/** A tinted message inside a row: a failure with its cause, or a warning. */
export function DiagnosticsCallout({
  tone,
  title,
  children,
}: DiagnosticsCalloutProps): ReactElement {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "danger"
          ? "border-destructive-border/70 bg-destructive-surface text-destructive-surface-foreground"
          : "border-warning-border/70 bg-warning-surface text-warning-surface-foreground",
      )}
    >
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 break-words">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** Marks a shown result as earlier, after a failed refresh. */
function DiagnosticsEarlierResult({ notice }: { notice: string | null }): ReactElement | null {
  if (notice === null) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-warning-muted">
      <History className="size-3 shrink-0" aria-hidden />
      {notice}
    </p>
  );
}

/** A square tile that holds the icon of a row. */
export function DiagnosticsIconTile({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground",
        muted && "opacity-60",
      )}
    >
      {children}
    </div>
  );
}

const CHECK_ICONS = {
  git: GitBranch,
  "mcp-bridge": Cable,
  "repository-setup": FolderTree,
  "task-store": Database,
} satisfies Record<DiagnosticsCheckKey, LucideIcon>;

/** One check: its icon, the title and result, its details, and any failure. */
export function DiagnosticsCheckRow({ check }: { check: DiagnosticsCheckModel }): ReactElement {
  const Icon = CHECK_ICONS[check.key];
  return (
    <div className="space-y-2.5 px-4 py-3" data-testid={`diagnostics-check-${check.key}`}>
      <div className="flex items-center gap-3">
        <DiagnosticsIconTile>
          <Icon className="size-4" aria-hidden />
        </DiagnosticsIconTile>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex min-w-0 items-baseline gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{check.title}</span>
            {check.value ? (
              <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                {check.value}
              </span>
            ) : null}
          </p>
          {check.details.map((detail) => (
            <DiagnosticsDetail key={detail.label} detail={detail} />
          ))}
        </div>
        <DiagnosticsStatusPill status={check.status} />
      </div>
      {check.notice !== null || check.errors.length > 0 ? (
        <div className="space-y-2 pl-12">
          <DiagnosticsEarlierResult notice={check.notice} />
          {check.errors.map((error) => (
            <DiagnosticsCallout
              key={error}
              tone={check.status.health === "warning" ? "warning" : "danger"}
            >
              <p>{error}</p>
            </DiagnosticsCallout>
          ))}
        </div>
      ) : null}
    </div>
  );
}
