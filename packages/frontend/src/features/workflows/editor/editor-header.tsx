import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  History,
  Loader2,
  Pencil,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ActionMenu, type MenuCommand } from "../action-menu";
import { TooltipButton } from "../tooltip-button";
import { StatusPill, workflowStatus } from "../workflow-status";
import { WORKFLOWS_ROUTE, workflowPath } from "../workflow-routes";
import { useEditor, useEditorState, useEditorView } from "./editor-context";
import { VersionSwitcher } from "./version-switcher";

export type EditorHeaderCommands = {
  /** Null when another place offers Duplicate. */
  readonly duplicate: () => void;
  readonly openVersions: (() => void) | null;
  readonly openExport: (() => void) | null;
  readonly discardDraft: () => void;
  readonly publish: () => void;
  readonly duplicating: boolean;
};

function SaveStatus(): ReactElement {
  const { store } = useEditor();
  const save = useEditorState((state) => state.save);
  if (save.status === "failed")
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs text-destructive-muted" role="alert">
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={save.message}>
          Not saved
        </span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => store.getState().retrySave()}
        >
          <RotateCcw className="size-3.5" />
          Retry
        </Button>
      </span>
    );
  const saving = save.status === "saving";
  return (
    <span
      className="flex w-16 items-center gap-1 text-xs text-muted-foreground"
      title="The editor saves the draft as you edit"
    >
      {saving ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      ) : (
        <Check aria-hidden="true" className="size-3.5" />
      )}
      {saving ? "Saving" : "Saved"}
    </span>
  );
}

/** Undo, Redo, and the save status of an editable workflow. */
function HistoryCommands(): ReactElement {
  const { store } = useEditor();
  const canUndo = useEditorState((state) => state.past.length > 0);
  const canRedo = useEditorState((state) => state.future.length > 0);
  return (
    <div className="flex items-center gap-1">
      <SaveStatus />
      <TooltipButton
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        label="Undo"
        tooltip="Undo (⌘Z)"
        disabled={!canUndo}
        onClick={() => store.getState().undo()}
      >
        <Undo2 className="size-4" />
      </TooltipButton>
      <TooltipButton
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        label="Redo"
        tooltip="Redo (⇧⌘Z)"
        disabled={!canRedo}
        onClick={() => store.getState().redo()}
      >
        <Redo2 className="size-4" />
      </TooltipButton>
    </div>
  );
}

/** Versions, Export, Duplicate, and Discard draft, as the workflow offers them. */
function useMenuCommands(commands: EditorHeaderCommands, builtin: boolean): MenuCommand[] {
  const readOnly = useEditorState((state) => state.readOnly);
  const hasDraft = useEditorState((state) => state.hasDraft);
  const saving = useEditorState((state) => state.save.status === "saving");
  const list: MenuCommand[] = [];
  if (commands.openVersions)
    list.push({ label: "Versions", Icon: History, run: commands.openVersions });
  if (commands.openExport)
    list.push({ label: "Export as YAML", Icon: Download, run: commands.openExport });
  // The built-in workflow offers Duplicate as its main command, in the header.
  if (!builtin)
    list.push({
      label: "Duplicate",
      Icon: Copy,
      run: commands.duplicate,
      disabled: commands.duplicating,
      busy: commands.duplicating,
    });
  if (!readOnly && hasDraft)
    list.push({
      label: "Discard draft",
      Icon: Trash2,
      run: commands.discardDraft,
      disabled: saving,
      destructive: true,
    });
  return list;
}

const publishHintOf = (errorCount: number, saved: boolean): string => {
  if (errorCount > 0) return "Fix the problems first";
  if (!saved) return "Wait until the draft is saved";
  return "Publish the draft as the next version";
};

/** Publish while the workflow has a draft. Without a draft, the status pill says it is live. */
function PublishButton({ onPublish }: { onPublish: () => void }): ReactElement | null {
  const errorCount = useEditorView((view) => view.errorCount);
  const hasDraft = useEditorState((state) => state.hasDraft);
  const saved = useEditorState((state) => state.save.status === "saved");
  if (!hasDraft) return null;
  return (
    <TooltipButton
      type="button"
      size="sm"
      className="gap-1.5"
      label="Publish"
      tooltip={publishHintOf(errorCount, saved)}
      disabled={!saved || errorCount > 0}
      onClick={onPublish}
    >
      <Upload className="size-3.5" />
      Publish
    </TooltipButton>
  );
}

/**
 * One row: the way back, the name, the version menu, the history, and the commands of the
 * workflow. A published version offers the way back to the editable workflow.
 */
export function EditorHeader({
  builtin,
  routeVersion,
  latestVersion,
  libraryHasDraft,
  commands,
}: {
  builtin: boolean;
  routeVersion: number | null;
  latestVersion: number | null;
  /** Whether the library lists a draft. A version view has no draft of its own. */
  libraryHasDraft: boolean;
  commands: EditorHeaderCommands;
}): ReactElement {
  const name = useEditorState((state) => state.document.definition.label);
  const workflowId = useEditorState((state) => state.workflowId);
  const readOnly = useEditorState((state) => state.readOnly);
  const hasDraft = useEditorState((state) => state.hasDraft);
  const status = workflowStatus({ builtin, routeVersion, hasDraft, latestVersion });
  const menuCommands = useMenuCommands(commands, builtin);
  return (
    <header className="electron-titlebar-safe-area flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        <Link
          to={WORKFLOWS_ROUTE}
          className="shrink-0 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Workflows
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-sm font-semibold">{name || workflowId}</h1>
      </nav>
      {!builtin && latestVersion !== null ? (
        <VersionSwitcher
          workflowId={workflowId}
          status={status}
          routeVersion={routeVersion}
          latestVersion={latestVersion}
          hasDraft={routeVersion === null ? hasDraft : libraryHasDraft}
        />
      ) : (
        <StatusPill status={status} />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {readOnly ? null : <HistoryCommands />}
        <ActionMenu label="More commands" commands={menuCommands} />
        {builtin ? (
          <Button
            type="button"
            size="sm"
            className="ml-1 gap-1.5"
            disabled={commands.duplicating}
            onClick={commands.duplicate}
          >
            {commands.duplicating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Copy className="size-3.5" />
            )}
            Duplicate
          </Button>
        ) : null}
        {routeVersion === null ? null : (
          <Button asChild size="sm" className="ml-1 gap-1.5">
            <Link to={workflowPath(workflowId)}>
              <Pencil className="size-3.5" />
              {libraryHasDraft ? "Open the draft" : "Edit workflow"}
            </Link>
          </Button>
        )}
        {readOnly ? null : (
          <div className="ml-1">
            <PublishButton onPublish={commands.publish} />
          </div>
        )}
      </div>
    </header>
  );
}
