import "./workflow-editor.css";
import type { WorkflowLibrary } from "@openducktor/contracts";
import type { CompiledWorkflowCatalog } from "@openducktor/workflows";
import { PanelLeft } from "lucide-react";
import { memo, type ReactElement, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkflowCanvas } from "./canvas/workflow-canvas";
import { EditorContext, type EditorEnvironment, useEditorState } from "./editor-context";
import { useReturnFocus } from "./use-return-focus";
import { DeleteElementDialog } from "./delete-element-dialog";
import { type EditorDialogName, EditorDialogs } from "./editor-dialogs";
import { EditorHeader } from "./editor-header";
import { useEditorKeys } from "./editor-keys";
import type { EditorSession } from "./editor-session";
import { InspectorPanel } from "./inspector/inspector-panel";
import { OutlinePanel } from "./panels/outline-panel";
import { ProblemsPanel } from "./panels/problems-panel";
import { ReadOnlyNote } from "./read-only-note";
import { UnsavedDraftGuard } from "./unsaved-draft-guard";
import { useDuplicateWorkflow } from "../use-duplicate-workflow";
import { useEditorRoleCommands } from "./use-editor-role-commands";
import { useEditorDerivation } from "./use-editor-derivation";
import { useWideEditor } from "./use-wide-editor";

// Each panel reads its own store slices, so a selection change in the layout skips them.
const OutlinePanelMemo = memo(OutlinePanel);
const WorkflowCanvasMemo = memo(WorkflowCanvas);
const ProblemsPanelMemo = memo(ProblemsPanel);
const InspectorPanelMemo = memo(InspectorPanel);

/** The toggle of the element list in the canvas toolbar of a narrow editor. */
function OutlineToggle({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5 bg-sidebar shadow-xs aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      aria-pressed={open}
      onClick={() => onOpenChange(!open)}
    >
      <PanelLeft className="size-3.5" />
      Elements
    </Button>
  );
}

/**
 * The element list, canvas, problems bar, and details of an open workflow. The details panel
 * shows while an element is selected, so it always reads as the details of that element. A
 * narrow editor shows the element list on request and hides it when an element opens.
 */
function EditorPanels({
  wide,
  builtin,
  routeVersion,
}: {
  wide: boolean;
  builtin: boolean;
  routeVersion: number | null;
}): ReactElement {
  const readOnly = useEditorState((state) => state.readOnly);
  const selectionKey = useEditorState((state) => state.selection?.key ?? null);
  useReturnFocus(selectionKey);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  if (seenSelection !== selectionKey) {
    setSeenSelection(selectionKey);
    if (selectionKey !== null && !wide) setOutlineOpen(false);
  }
  const showOutline = wide || outlineOpen;
  const toolbar = useMemo(
    () => (
      <>
        {wide ? null : <OutlineToggle open={outlineOpen} onOpenChange={setOutlineOpen} />}
        <ReadOnlyNote builtin={builtin} routeVersion={routeVersion} />
      </>
    ),
    [wide, outlineOpen, builtin, routeVersion],
  );
  const showDetails = selectionKey !== null;
  return (
    // The panel sizes last while the editor stays open. Saving them would add browser storage.
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      {showOutline ? (
        <>
          <ResizablePanel
            id="workflow-elements"
            defaultSize="272px"
            minSize="220px"
            maxSize="420px"
          >
            <aside
              aria-label="Workflow elements panel"
              data-focus-panel=""
              tabIndex={-1}
              className="h-full bg-sidebar outline-none"
            >
              <OutlinePanelMemo />
            </aside>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize the element list" withHandle />
        </>
      ) : null}
      <ResizablePanel id="workflow-canvas" minSize="320px">
        <div className="flex h-full min-w-0 flex-col">
          <div data-focus-panel="" tabIndex={-1} className="min-h-0 flex-1 outline-none">
            <WorkflowCanvasMemo toolbar={toolbar} />
          </div>
          {readOnly ? null : <ProblemsPanelMemo />}
        </div>
      </ResizablePanel>
      {showDetails ? (
        <>
          <ResizableHandle aria-label="Resize the details" withHandle />
          <ResizablePanel
            id="workflow-details"
            defaultSize={wide ? "400px" : "352px"}
            minSize="320px"
            maxSize="640px"
          >
            <aside aria-label="Details of the selection" className="h-full bg-sidebar">
              <InspectorPanelMemo />
            </aside>
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

/** One open workflow: header, outline, canvas, inspector, problems, and their dialogs. */
export function WorkflowEditor({
  session,
  catalog,
  library,
  onReload,
}: {
  session: EditorSession;
  catalog: CompiledWorkflowCatalog;
  library: WorkflowLibrary;
  /** Reads the document again after a publication or a discard, and seeds a new editor. */
  onReload: () => Promise<void>;
}): ReactElement {
  const { store, seed, routeVersion } = session;
  const workflowId = useStore(store, (state) => state.workflowId);
  const readOnly = useStore(store, (state) => state.readOnly);
  const builtin = seed.source === "builtin";
  const published = seed.latestVersion !== null;
  const [dialog, setDialog] = useState<EditorDialogName | null>(null);
  const { duplicate, duplicatingId } = useDuplicateWorkflow();
  const duplicating = duplicatingId !== null;
  const { roles, roleDialog } = useEditorRoleCommands(store, library.roles);
  const derived = useEditorDerivation(store, catalog, library, published);
  useEditorKeys(store);
  const rootRef = useRef<HTMLDivElement>(null);
  const wide = useWideEditor(rootRef);

  const environment = useMemo(
    (): EditorEnvironment | null =>
      derived.error === null
        ? {
            store,
            viewOf: derived.viewOf,
            catalogRoles: library.roles,
            roles,
            published,
            takenWorkflowIds: derived.context.takenWorkflowIds,
            sharedStates: derived.context.sharedStates,
          }
        : null,
    [derived, store, library.roles, roles, published],
  );

  if (environment === null)
    return (
      <Alert variant="destructive" className="m-4">
        <AlertDescription>
          The workflow check could not start. {derived.error} Refresh the page after the host
          catalog updates.
        </AlertDescription>
      </Alert>
    );

  // A custom workflow with a version has a version list and an export file.
  const versioned = !builtin && published;
  return (
    <EditorContext value={environment}>
      <TooltipProvider>
        {readOnly ? null : <UnsavedDraftGuard store={store} />}
        {/* The layout waits for the first measure of the editor width, before the first paint. */}
        <div
          ref={rootRef}
          className="workflow-editor @container flex h-full min-h-0 flex-col bg-sidebar"
        >
          {wide === null ? null : (
            <>
              <EditorHeader
                builtin={builtin}
                routeVersion={routeVersion}
                latestVersion={seed.latestVersion}
                libraryHasDraft={Boolean(
                  library.workflows.find((entry) => entry.id === workflowId)?.draft,
                )}
                commands={{
                  duplicate: () => duplicate(workflowId),
                  duplicating,
                  openVersions: versioned ? () => setDialog("versions") : null,
                  openExport: versioned ? () => setDialog("export") : null,
                  discardDraft: () => setDialog("discard"),
                  publish: () => setDialog("publish"),
                }}
              />
              <EditorPanels wide={wide} builtin={builtin} routeVersion={routeVersion} />
            </>
          )}
        </div>
        <DeleteElementDialog />
        <EditorDialogs
          dialog={dialog}
          onDialogChange={setDialog}
          latestVersion={seed.latestVersion}
          onReload={onReload}
        />
        {roleDialog}
      </TooltipProvider>
    </EditorContext>
  );
}
