import type { WorkflowLibraryEntry } from "@openducktor/contracts";
import { Bot, Columns3, type LucideIcon, Plus, Rocket, Spline } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS: readonly {
  Icon: LucideIcon;
  tile: string;
  title: string;
  text: string;
}[] = [
  {
    Icon: Columns3,
    tile: "bg-violet-500/12 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
    title: "Columns",
    text: "The states that a task goes through.",
  },
  {
    Icon: Spline,
    tile: "bg-sky-500/12 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
    title: "Transitions",
    text: "Buttons move a task from one column to the next.",
  },
  {
    Icon: Bot,
    tile: "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
    title: "Agents",
    text: "Roles such as Planner or QA do the work.",
  },
  {
    Icon: Rocket,
    tile: "bg-amber-500/14 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    title: "Publish",
    text: "Every repository can then use it for new tasks.",
  },
];

/**
 * Shows while the host has no custom workflow: what a workflow is made of, and the way to make one.
 * Nothing changes for the tasks until the user publishes a workflow.
 */
export function EmptyWorkflowsCard({
  workflows,
  onCreate,
}: {
  workflows: readonly WorkflowLibraryEntry[];
  onCreate: () => void;
}): ReactElement | null {
  if (workflows.some(({ source }) => source === "custom")) return null;
  return (
    <section
      aria-labelledby="empty-workflows-title"
      className="flex flex-col gap-5 rounded-xl border border-dashed border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="empty-workflows-title" className="text-base font-semibold">
            Make a workflow of your own
          </h2>
          <p className="text-sm text-muted-foreground">
            Start from a copy of the built-in workflow, then change what you need.
          </p>
        </div>
        <Button type="button" className="gap-1.5" onClick={onCreate}>
          <Plus className="size-4" />
          New workflow
        </Button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ Icon, tile, title, text }, index) => (
          <li key={title} className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
            <span
              className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tile)}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {index + 1}. {title}
              </span>
              <span className="text-xs leading-5 text-muted-foreground">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
