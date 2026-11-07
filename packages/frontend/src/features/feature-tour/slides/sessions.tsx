import { ListChecks, type LucideIcon, MessagesSquare } from "lucide-react";
import { Fragment, type ReactElement, type ReactNode } from "react";
import { roleOptionsForTask } from "@/lib/agent-role-presentation";
import { cn } from "@/lib/utils";
import { TASKS } from "../feature-tour-samples";
import type { FeatureTourSlide } from "../feature-tour-stage";

// Slide 5: the two kinds of agent sessions, compared row by row, with app parts as examples.

const ROLE_OPTIONS = roleOptionsForTask(TASKS.titles);

/** The roles of the workflow, as equal chips with their sidebar icons. */
function TourRoleChips(): ReactElement {
  return (
    <span className="flex flex-wrap gap-1.5">
      {ROLE_OPTIONS.map(({ role, label, icon: Icon }) => (
        <span
          key={role}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium"
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </span>
      ))}
    </span>
  );
}

type SessionKindRow = { label: string; task: ReactNode; session: ReactNode };

const SESSION_KIND_ROWS: SessionKindRow[] = [
  {
    label: "What it is",
    task: "An agent that runs one workflow role on one task.",
    session:
      "An agent in your workspace. It reads and edits code, runs commands, and creates and updates tasks.",
  },
  {
    label: "Use it to",
    task: "Carry out a change that you know you want, from spec to QA review.",
    session:
      "Explore, analyze, research, or audit your code. Then let it create the tasks for the work.",
  },
  {
    label: "Role",
    task: <TourRoleChips />,
    session: (
      <span className="grid gap-1.5">
        <span className="inline-flex h-7 w-fit items-center rounded-md border border-dashed border-muted-foreground/70 px-2.5 text-[13px] font-medium text-foreground/80">
          Custom role, optional
        </span>
        <span>Your own instructions, such as a researcher.</span>
      </span>
    ),
  },
  {
    label: "Start it from",
    task: "The next-step button of its card on the Kanban board, such as Start Planner.",
    session: "The menu of the New task button, at the top of the sidebar: select New session.",
  },
  {
    label: "Changes go to",
    task: "The task branch, in the task's own worktree. Spec, Planner, and QA save artifacts.",
    session:
      "Your current checkout, a new worktree, or a worktree that exists. You choose when you start it.",
  },
];

/** A column title of the comparison, with the sidebar icon of the kind and what sets it apart. */
function SessionKindTitle({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}): ReactElement {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="grid">
        <span className="text-base font-semibold leading-6 text-foreground">{title}</span>
        <span className="text-[13px] leading-5 text-foreground/70">{detail}</span>
      </span>
    </span>
  );
}

/** The two kinds of agent sessions side by side. */
function SessionKindsPicture(): ReactElement {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-[var(--t-tour-inset)] py-8">
      <div className="w-full max-w-[64rem] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <p className="border-b border-border bg-primary/10 px-5 py-2.5 text-sm text-foreground">
          <span className="font-semibold">Rule of thumb:</span> not sure yet what to build? Start a
          session to explore. You know where you are going? Create a task.
        </p>
        <div className="grid grid-cols-[9.5rem_minmax(0,1fr)_minmax(0,1fr)] text-sm leading-6 text-foreground">
          <span className="border-b border-border bg-muted/40" />
          <span className="border-b border-l border-border bg-muted/40 px-5 py-3">
            <SessionKindTitle icon={ListChecks} title="Task session" detail="Tied to one task" />
          </span>
          <span className="border-b border-l border-border bg-muted/40 px-5 py-3">
            <SessionKindTitle icon={MessagesSquare} title="Session" detail="Not tied to a task" />
          </span>
          {SESSION_KIND_ROWS.map((row, index) => {
            const isLast = index === SESSION_KIND_ROWS.length - 1;
            return (
              <Fragment key={row.label}>
                <span
                  className={cn(
                    "px-5 py-3 text-[13px] font-medium text-foreground/70",
                    !isLast && "border-b border-border",
                  )}
                >
                  {row.label}
                </span>
                <div className={cn("border-l border-border px-5 py-3", !isLast && "border-b")}>
                  {row.task}
                </div>
                <div className={cn("border-l border-border px-5 py-3", !isLast && "border-b")}>
                  {row.session}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const sessionsSlide: FeatureTourSlide = {
  id: "sessions",
  title: "Two kinds of agent sessions",
  text: "Both kinds run Claude Code, Codex, or OpenCode in your repository. Explore in a session first. When you know what to build, it creates the tasks, and task sessions carry them out.",
  picture: <SessionKindsPicture />,
};
