import { plural } from "@openducktor/frontend-core/lib/plural";
import { ListFilter, Workflow } from "lucide-react";
import { type ReactElement, useId, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { ListHeading } from "./settings-prompt-page-header";
import {
  PromptRows,
  ROW_BUTTON_CLASS_NAME,
  ROW_LIST_CLASS_NAME,
  RowChevron,
  useRestoreRowFocus,
  WorkflowErrors,
} from "./settings-prompt-rows";
import type { PromptHomeView, PromptRowData, PromptWorkflow } from "./settings-prompt-owners";

type PromptHomeProps = {
  title: string;
  description: string;
  /** The rows, the workflows, and the results of the filter. */
  view: PromptHomeView;
  query: string;
  changedOnly: boolean;
  /** The prompt or the workflow that the user just left. Its row gets the focus again. */
  focusKey: string | null;
  disabled: boolean;
  onQueryChange: (query: string) => void;
  onChangedOnlyChange: (changedOnly: boolean) => void;
  onOpenPrompt: (key: string) => void;
  onOpenWorkflow: (ownerId: string) => void;
};

/** The state of a workflow: its prompts and its changes. */
function WorkflowSummary({ workflow }: { workflow: PromptWorkflow }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
      {plural(workflow.promptCount, "prompt")}
      {workflow.changedCount > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{workflow.changedCount} changed</span>
        </>
      ) : null}
    </span>
  );
}

function WorkflowRow({
  workflow,
  disabled,
  onOpen,
}: {
  workflow: PromptWorkflow;
  disabled: boolean;
  onOpen: (ownerId: string) => void;
}): ReactElement {
  const labelId = useId();
  const summaryId = useId();
  const errorsId = useId();
  return (
    <li>
      <button
        type="button"
        data-focus-key={workflow.id}
        aria-labelledby={labelId}
        aria-describedby={workflow.errorCount > 0 ? `${summaryId} ${errorsId}` : summaryId}
        disabled={disabled}
        className={ROW_BUTTON_CLASS_NAME}
        onClick={() => onOpen(workflow.id)}
      >
        <Workflow className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={labelId} className="truncate text-sm font-medium text-foreground">
            {workflow.title}
          </span>
          <span id={summaryId}>
            <WorkflowSummary workflow={workflow} />
          </span>
        </span>
        <WorkflowErrors id={errorsId} workflow={workflow} />
        <RowChevron />
      </button>
    </li>
  );
}

/** The changed prompts filter: a toggle button that shows how many prompts changed when it is on. */
function ChangedOnlyButton({
  changedOnly,
  changedCount,
  onChange,
}: {
  changedOnly: boolean;
  changedCount: number;
  onChange: (changedOnly: boolean) => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="toggle"
      aria-pressed={changedOnly}
      className="gap-1.5 px-3"
      onClick={() => onChange(!changedOnly)}
    >
      <ListFilter aria-hidden="true" className="size-3.5 text-muted-foreground" />
      Changed only
      {changedOnly ? (
        <Badge variant="secondary" className="rounded-sm px-1.5 font-normal tabular-nums">
          {changedCount}
        </Badge>
      ) : null}
    </Button>
  );
}

function WorkflowRows({
  workflows,
  disabled,
  onOpen,
}: {
  workflows: readonly PromptWorkflow[];
  disabled: boolean;
  onOpen: (ownerId: string) => void;
}): ReactElement {
  return (
    <ul className={ROW_LIST_CLASS_NAME}>
      {workflows.map((workflow) => (
        <WorkflowRow key={workflow.id} workflow={workflow} disabled={disabled} onOpen={onOpen} />
      ))}
    </ul>
  );
}

/** The prompts of an owner that the filter keeps, under the name of the owner. */
function OwnerResults({
  title,
  rows,
  disabled,
  onOpenPrompt,
}: {
  title: string;
  rows: PromptRowData[];
  disabled: boolean;
  onOpenPrompt: (key: string) => void;
}): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      {/* The name of the owner stays at the top while its rows scroll, in long results. */}
      <div className="sticky top-0 z-10 -my-1 bg-popover py-1">
        <ListHeading id={headingId} title={title} />
      </div>
      {/* A row that the keyboard reaches stops below the sticky heading, not under it. */}
      <PromptRows
        className="[&_li>button]:scroll-mt-10"
        rows={rows}
        ownerId={headingId}
        disabled={disabled}
        onOpen={onOpenPrompt}
      />
    </section>
  );
}

/** Why a search or the Changed only filter shows nothing. */
const emptyResultsMessage = (changedOnly: boolean, hasQuery: boolean): string => {
  if (!changedOnly) return "No prompt matches your search.";
  if (hasQuery) return "No changed prompt matches your search.";
  return "You have not changed any prompt yet.";
};

function EmptyResults({
  changedOnly,
  hasQuery,
  onClear,
}: {
  changedOnly: boolean;
  hasQuery: boolean;
  onClear: () => void;
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">{emptyResultsMessage(changedOnly, hasQuery)}</p>
      <Button type="button" size="sm" variant="outline" onClick={onClear}>
        {changedOnly ? "Clear filters" : "Clear search"}
      </Button>
    </div>
  );
}

type FilterResultsView = Extract<PromptHomeView, { mode: "results" }>;

/** What a screen reader hears after a filter change, for example "1 workflow, 3 prompts shown". */
const shownText = ({ matchingWorkflows, resultCount }: FilterResultsView): string =>
  `${[
    matchingWorkflows.length > 0 ? plural(matchingWorkflows.length, "workflow") : "",
    plural(resultCount, "prompt"),
  ]
    .filter(Boolean)
    .join(", ")} shown`;

/** The prompts and the workflows that a search or the Changed only filter keeps. */
function FilterResults({
  view,
  changedOnly,
  disabled,
  onClear,
  onOpenPrompt,
  onOpenWorkflow,
}: {
  view: FilterResultsView;
  changedOnly: boolean;
  disabled: boolean;
  onClear: () => void;
  onOpenPrompt: (key: string) => void;
  onOpenWorkflow: (ownerId: string) => void;
}): ReactElement {
  const { matchingWorkflows, results, resultCount } = view;
  return (
    <>
      {matchingWorkflows.length > 0 ? (
        <section aria-label="Workflows" className="flex flex-col gap-2">
          <ListHeading title="Workflows" />
          <WorkflowRows workflows={matchingWorkflows} disabled={disabled} onOpen={onOpenWorkflow} />
        </section>
      ) : null}
      {results.map(({ id, title, rows }) => (
        <OwnerResults
          key={id}
          title={title}
          rows={rows}
          disabled={disabled}
          onOpenPrompt={onOpenPrompt}
        />
      ))}
      {matchingWorkflows.length + resultCount === 0 ? (
        <EmptyResults changedOnly={changedOnly} hasQuery={view.hasQuery} onClear={onClear} />
      ) : null}
    </>
  );
}

/**
 * The first screen of the prompts: the instructions of each agent role, and each workflow with
 * the state of its prompts. A search or the Changed only filter shows the prompts of every owner.
 */
export function PromptHome({
  title,
  description,
  view,
  query,
  changedOnly,
  focusKey,
  disabled,
  onQueryChange,
  onChangedOnlyChange,
  onOpenPrompt,
  onOpenWorkflow,
}: PromptHomeProps): ReactElement {
  const searchId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  useRestoreRowFocus(listRef, focusKey);

  return (
    <div className="grid gap-4 p-4">
      <header className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">
          OpenDucktor sends these prompts to your agents. Open a prompt to add your instructions
          after it or to replace it. {description}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <ToolbarSearchField
            id={searchId}
            size="lg"
            label="Search all prompts"
            value={query}
            placeholder="Search all prompts"
            onValueChange={onQueryChange}
          />
        </div>
        <ChangedOnlyButton
          changedOnly={changedOnly}
          changedCount={view.changedCount}
          onChange={onChangedOnlyChange}
        />
      </div>
      <p role="status" className="sr-only">
        {view.mode === "results" ? shownText(view) : ""}
      </p>
      <div
        ref={listRef}
        tabIndex={-1}
        role="region"
        aria-label={title}
        className="@container/prompts flex flex-col gap-6 outline-none"
      >
        {view.mode === "results" ? (
          <FilterResults
            view={view}
            changedOnly={changedOnly}
            disabled={disabled}
            onClear={() => {
              onQueryChange("");
              onChangedOnlyChange(false);
            }}
            onOpenPrompt={onOpenPrompt}
            onOpenWorkflow={onOpenWorkflow}
          />
        ) : (
          <>
            <section aria-label="Agent roles" className="flex flex-col gap-2">
              <ListHeading
                title="Agent roles"
                description="Each session of a role starts with its instructions. A change applies to the role in every workflow."
              />
              <PromptRows rows={view.roleRows} disabled={disabled} onOpen={onOpenPrompt} />
            </section>
            <section aria-label="Workflows" className="flex flex-col gap-2">
              <ListHeading
                title="Workflows"
                description="Each workflow has rules for its sessions and messages that start its steps. Open a workflow to see its prompts."
              />
              <WorkflowRows
                workflows={view.workflows}
                disabled={disabled}
                onOpen={onOpenWorkflow}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
