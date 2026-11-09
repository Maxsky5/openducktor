import { type ReactElement, useLayoutEffect, useRef } from "react";
import { WORKFLOW_PROMPTS_DESCRIPTION } from "./settings-modal-constants";
import { ListHeading, PromptPageHeader } from "./settings-prompt-page-header";
import { PromptRows, useRestoreRowFocus, WorkflowErrors } from "./settings-prompt-rows";
import type { PromptWorkflow } from "./settings-prompt-owners";

type PromptWorkflowPageProps = {
  /** The screen that the back link returns to, such as System prompts. */
  backTitle: string;
  workflow: PromptWorkflow;
  /** The prompt that the user just closed. Its row gets the focus again. */
  focusKey: string | null;
  disabled: boolean;
  onBack: () => void;
  onOpenPrompt: (key: string) => void;
};

/** The prompts of one workflow, by when the agent gets them. */
export function PromptWorkflowPage({
  backTitle,
  workflow,
  focusKey,
  disabled,
  onBack,
  onOpenPrompt,
}: PromptWorkflowPageProps): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useRestoreRowFocus(listRef, focusKey);
  // The title takes the focus from the workflow row, which unmounts.
  useLayoutEffect(() => {
    if (!focusKey) titleRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  return (
    <div className="grid gap-4 p-4">
      <PromptPageHeader
        backTitle={backTitle}
        title={workflow.title}
        titleRef={titleRef}
        aside={<WorkflowErrors workflow={workflow} />}
        onBack={onBack}
      >
        <p className="text-xs text-muted-foreground">{WORKFLOW_PROMPTS_DESCRIPTION}</p>
      </PromptPageHeader>
      <div
        ref={listRef}
        tabIndex={-1}
        role="region"
        aria-label={`Prompts of ${workflow.title}`}
        className="@container/prompts flex flex-col gap-6 outline-none"
      >
        {workflow.groups.map((group) => (
          <section key={group.id} aria-label={group.title} className="flex flex-col gap-2">
            <ListHeading title={group.title} description={group.description} />
            <PromptRows rows={group.rows} disabled={disabled} onOpen={onOpenPrompt} />
          </section>
        ))}
      </div>
    </div>
  );
}
