import type { WorkspaceProcessGroup, WorkspaceProcessRow } from "@openducktor/contracts";
import { ChevronRight, FolderGit2, GitBranch } from "lucide-react";
import { type ReactElement, useState } from "react";
import { CssPresenceList, useCssPresence } from "@/components/ui/css-presence";
import { CssPresenceReveal } from "@/components/ui/css-presence-reveal";
import { cn } from "@/lib/utils";
import { ProcessAppRow, ProcessCommandRow } from "./process-command-row";
import { countLabel, groupSubtitle, groupTitle } from "./processes-labels";
import { linkOf, type ProcessGroupView } from "./processes-view";

type ProcessGroupSectionProps = {
  view: ProcessGroupView;
  filter: string;
  /** The URL that Enter in the filter opens, or null. */
  enterUrl: string | null;
  /** True for the checkout of the task that the user works on. */
  focused: boolean;
  /** False for the other workspaces, which start folded. */
  initiallyOpen: boolean;
  stoppingRefs: ReadonlySet<string>;
  isRowOutdated: (row: WorkspaceProcessRow) => boolean;
  onOpenUrl: (url: string) => void;
  onStop: (
    group: WorkspaceProcessGroup,
    rows: readonly WorkspaceProcessRow[],
    label: string,
  ) => void;
};

/**
 * One checkout under a thin header that stays at the top while its commands scroll. The header
 * folds the checkout, and a folded checkout still names its ports.
 */
export function ProcessGroupSection({
  view,
  filter,
  enterUrl,
  focused,
  initiallyOpen,
  stoppingRefs,
  isRowOutdated,
  onOpenUrl,
  onStop,
}: ProcessGroupSectionProps): ReactElement {
  const { presenceProps } = useCssPresence();
  const [unfolded, setUnfolded] = useState(initiallyOpen);
  // A filter opens every checkout, so each match shows.
  const open = filter.trim() !== "" || unfolded;
  const { group, commands, apps } = view;
  const GroupIcon = group.kind === "repository" ? FolderGit2 : GitBranch;
  const title = groupTitle(group);
  const subtitle = groupSubtitle(group);
  const ports = [...commands, ...apps].flatMap((entry) => entry.listeners);
  const processCount = [...commands, ...apps].reduce(
    (total, entry) => total + entry.members.length,
    0,
  );
  return (
    <section {...presenceProps} aria-label={title} className="css-presence process-presence">
      <h3 className="sticky top-0 z-10 border-b border-border/60 bg-popover">
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 overflow-hidden bg-muted/50 px-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          aria-expanded={open}
          title={group.checkoutPath}
          onClick={() => setUnfolded(!open)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 ease-(--motion-ease-out)",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          <GroupIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
            {title}
          </span>
          {subtitle ? (
            <span
              className={cn(
                "max-w-48 min-w-0 truncate text-muted-foreground",
                subtitle.taskIds ? "font-mono text-[11px]" : "text-xs",
              )}
            >
              {subtitle.text}
            </span>
          ) : null}
          {focused ? (
            <span className="shrink-0 rounded-sm bg-info-surface px-1.5 py-px text-[10px] font-medium text-info-surface-foreground">
              This task
            </span>
          ) : null}
          {open ? null : (
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11px] text-muted-foreground tabular-nums">
              {ports.slice(0, 3).map((listener) => (
                <span
                  key={`${listener.address}:${listener.port}`}
                  className="font-mono text-status-running-foreground"
                >
                  :{listener.port}
                </span>
              ))}
              {countLabel(processCount, "process", "processes")}
            </span>
          )}
        </button>
      </h3>
      <CssPresenceReveal open={open}>
        <ul className="flex flex-col pt-1">
          <CssPresenceList>
            {[
              ...commands.map((command) => (
                <ProcessCommandRow
                  key={command.root.processRef}
                  command={command}
                  checkoutPath={group.checkoutPath}
                  filter={filter}
                  stoppingRefs={stoppingRefs}
                  isRowOutdated={isRowOutdated}
                  enterTarget={
                    enterUrl !== null &&
                    command.listeners.some((listener) => linkOf(listener) === enterUrl)
                  }
                  onOpenUrl={onOpenUrl}
                  onStop={(rows, label) => onStop(group, rows, label)}
                />
              )),
              ...apps.map((app) => (
                <ProcessAppRow
                  key={`app:${app.name}`}
                  app={app}
                  checkoutPath={group.checkoutPath}
                  filter={filter}
                  stoppingRefs={stoppingRefs}
                  isRowOutdated={isRowOutdated}
                  onOpenUrl={onOpenUrl}
                  onStop={(rows, label) => onStop(group, rows, label)}
                />
              )),
            ]}
          </CssPresenceList>
        </ul>
      </CssPresenceReveal>
    </section>
  );
}
