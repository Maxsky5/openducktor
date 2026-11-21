import { Panel } from "@xyflow/react";
import { Check, ChevronDown, Compass } from "lucide-react";
import { memo, type ReactElement, useState } from "react";
import { cn } from "@/lib/utils";
import { useEditor, useEditorState, useEditorView } from "../editor-context";
import { gettingStartedSteps } from "../model/getting-started";

/**
 * The steps from a new workflow to its first publication, on the canvas. Each step checks itself
 * from the workflow, and the current step tells how to do it. The card folds to its header, and it
 * goes once the workflow is published.
 */
export const GettingStarted = memo(function GettingStarted(): ReactElement | null {
  const { published } = useEditor();
  const definition = useEditorState((state) => state.document.definition);
  const hasDraft = useEditorState((state) => state.hasDraft);
  const errorCount = useEditorView((view) => view.errorCount);
  // A new workflow opens the card. One that already has transitions starts folded, so the card
  // covers less of the canvas.
  const [open, setOpen] = useState(() => definition.events.length === 0);
  // The details panel narrows the canvas, so the card folds while it shows, and opens again after.
  const detailsOpen = useEditorState((state) => state.selection !== null);
  const [seenDetails, setSeenDetails] = useState(detailsOpen);
  const [foldedForDetails, setFoldedForDetails] = useState(false);
  if (seenDetails !== detailsOpen) {
    setSeenDetails(detailsOpen);
    if (detailsOpen && open) {
      setOpen(false);
      setFoldedForDetails(true);
    } else if (!detailsOpen && foldedForDetails) {
      setOpen(true);
      setFoldedForDetails(false);
    }
  }
  const steps = gettingStartedSteps(definition, { published, hasDraft, errorCount });
  const doneCount = steps.filter(({ done }) => done).length;
  // The guide helps until the first publication. After it, edits are routine.
  if (published || doneCount === steps.length) return null;
  const current = steps.find(({ done }) => !done);
  return (
    <Panel position="top-right" className="!m-3">
      <section
        aria-label="Getting started"
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-sidebar/95 shadow-lg backdrop-blur",
          open ? "w-72" : "w-max",
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setFoldedForDetails(false);
          }}
          className="flex w-full items-center gap-2.5 px-3 py-1 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary-emphasis dark:bg-primary/20">
            <Compass aria-hidden="true" className="size-3.5" />
          </span>
          {/* Folded, the card names the next step, so it still guides. */}
          <span className="flex-1 text-[13px] font-semibold whitespace-nowrap">
            {open || !current ? (
              "Getting started"
            ) : (
              <>
                <span className="font-normal text-muted-foreground">Next: </span>
                {current.title}
              </>
            )}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {doneCount} of {steps.length}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200",
              !open && "-rotate-90",
            )}
          />
        </button>
        <div aria-hidden="true" className="h-0.5 bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
        {open ? (
          <ol className="flex flex-col gap-0.5 p-2">
            {steps.map((step, index) => {
              const active = step === current;
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg px-2 py-1.5",
                    active && "bg-primary/8 dark:bg-primary/12",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums",
                      step.done && "border-emerald-500 bg-emerald-500 text-white",
                      active && "border-primary text-primary-emphasis",
                      !step.done && !active && "border-border text-muted-foreground",
                    )}
                  >
                    {step.done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={cn(
                        "text-[13px]",
                        step.done &&
                          "text-muted-foreground line-through decoration-muted-foreground/40",
                        active && "font-medium",
                      )}
                    >
                      {step.title}
                      <span className="sr-only">{step.done ? " (done)" : ""}</span>
                    </span>
                    {active ? (
                      <span className="text-xs leading-5 text-pretty text-muted-foreground">
                        {step.how}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>
    </Panel>
  );
});
