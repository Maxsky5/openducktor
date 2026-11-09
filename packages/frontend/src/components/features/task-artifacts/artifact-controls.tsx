import type { ShortcutActionId } from "@openducktor/contracts";
import {
  ShortcutScope,
  ShortcutButton,
  ShortcutText,
} from "@/features/shortcuts/shortcut-controls";
import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import { useShortcutPortalOwner } from "@/features/shortcuts/shortcut-focus";

import { useArtifactWorkflow } from "./task-artifact-workflow-context";
import type { FreeTaskArtifact, TaskAssetRenderContext } from "@openducktor/contracts";
import type { TaskArtifactContent } from "@openducktor/frontend-core/queries/artifacts";
import { isEditableWorkflowDocument } from "@openducktor/workflows";
import { Download, Ellipsis, Expand, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { type ComponentProps, type ReactElement, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { DocumentCopyButton } from "@/components/ui/document-copy-button";
import { MarkdownPreviewModal } from "@/components/ui/markdown-preview-modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { useOnSessionViewHide } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import type { ArtifactAction } from "./artifact-action-dialog";
import { TaskArtifactPreviewDialog } from "./task-artifact-preview-dialog";

export function FreeArtifactControls({
  artifact,
  content,
  canManage,
  onAction,
}: {
  artifact: FreeTaskArtifact;
  content: TaskArtifactContent | undefined;
  canManage: boolean;
  onAction: (action: ArtifactAction, trigger: HTMLElement) => void;
}): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const opensDialog = useRef(false);
  const menuRef = useShortcutPortalOwner(menuTrigger, () => {
    opensDialog.current = true;
    setMenuOpen(false);
  });
  const expandTrigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [modalSnapshot, setModalSnapshot] = useState<TaskArtifactContent | null>(null);
  const modalPresence = useDialogPresence(expanded);
  const contentOwner = useLocalShortcuts(
    expandTrigger,
    [
      {
        id: "content-open" as const,
        run: () => {
          if (content) {
            setModalSnapshot(content);
            setExpanded(true);
          }
        },
        disabledReason: content ? null : "Load the artifact first.",
      },
    ],
    "[data-artifact-view]",
  );
  const actionOwner = useLocalShortcuts(
    menuTrigger,
    (["rename", "replace", "delete"] as const).map((kind) => ({
      id: `artifact-${kind}`,
      disabledReason: canManage ? null : "Artifact changes are unavailable.",
      run: () => {
        const trigger = menuTrigger.current;
        if (trigger) onAction({ kind, artifact }, trigger);
      },
    })),
    "[data-artifact-view]",
  );
  // The panel keeps its state with the kept view, so a switch closes the menu and the preview.
  useOnSessionViewHide(() => {
    setMenuOpen(false);
    setExpanded(false);
  });
  return (
    <ShortcutScope owners={[contentOwner, actionOwner]}>
      <>
        {content?.artifact.classification === "free" ? (
          <>
            <DownloadButton
              artifact={content.artifact}
              bytes={content.bytes}
              disabled={content.artifact.revision !== artifact.revision}
            />
            <ToolButton
              ref={expandTrigger}
              shortcutId="content-open"
              label="Expand"
              onClick={() => {
                setModalSnapshot(content);
                setExpanded(true);
              }}
            >
              <Expand aria-hidden="true" />
            </ToolButton>
          </>
        ) : null}
        {canManage ? (
          <Popover
            open={menuOpen}
            onOpenChange={(open) => {
              opensDialog.current = false;
              setMenuOpen(open);
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    ref={menuTrigger}
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Artifact actions"
                  >
                    <Ellipsis aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Artifact actions</TooltipContent>
            </Tooltip>
            <PopoverContent
              ref={menuRef}
              align="end"
              aria-label="Artifact actions"
              className="w-44 p-1.5"
              onCloseAutoFocus={(event) => {
                if (opensDialog.current) event.preventDefault();
              }}
            >
              {(
                [
                  { kind: "rename", label: "Rename", Icon: Pencil },
                  { kind: "replace", label: "Replace content", Icon: RefreshCw },
                  { kind: "delete", label: "Delete", Icon: Trash2 },
                ] as const
              ).map(({ kind, label, Icon }) => (
                <ShortcutButton
                  shortcutId={`artifact-${kind}`}
                  key={kind}
                  type="button"
                  variant={kind === "delete" ? "destructiveGhost" : "ghost"}
                  size="sm"
                  className="w-full justify-start"
                  onClick={(event) => {
                    opensDialog.current = true;
                    setMenuOpen(false);
                    onAction({ kind, artifact }, menuTrigger.current ?? event.currentTarget);
                  }}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </ShortcutButton>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
        {modalPresence && modalSnapshot ? (
          <TaskArtifactPreviewDialog
            content={modalSnapshot}
            open={expanded}
            onOpenChange={setExpanded}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              expandTrigger.current?.focus();
            }}
          />
        ) : null}
      </>
    </ShortcutScope>
  );
}

export function WorkflowArtifactControls({
  taskId,
  workflowCode,
  name,
  markdown,
  taskAssetContext,
}: {
  taskId: string;
  workflowCode: string;
  name: string;
  markdown: string | undefined;
  taskAssetContext: Omit<TaskAssetRenderContext, "assetId"> | undefined;
}): ReactElement {
  const workflowActions = useTaskWorkflowActions();
  const expandTrigger = useRef<HTMLButtonElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [modalSnapshot, setModalSnapshot] = useState<{ title: string; markdown: string } | null>(
    null,
  );
  const modalPresence = useDialogPresence(expanded);
  // The panel keeps its state with the kept view, so a switch closes the preview.
  useOnSessionViewHide(() => setExpanded(false));
  const taskWorkflow = useArtifactWorkflow();
  const editSection = isEditableWorkflowDocument(workflowCode, taskWorkflow) ? workflowCode : null;
  const editOwner = useLocalShortcuts(
    editTrigger,
    [
      {
        id: "artifact-edit" as const,
        run: () => {
          if (editSection) workflowActions?.onEdit(taskId, { artifactCode: editSection });
        },
        disabledReason: editSection && workflowActions ? null : "This artifact cannot be edited.",
      },
    ],
    "[data-artifact-view]",
  );
  const contentOwner = useLocalShortcuts(
    expandTrigger,
    [
      {
        id: "content-open" as const,
        run: () => {
          if (markdown !== undefined) {
            setModalSnapshot({ title: name, markdown });
            setExpanded(true);
          }
        },
        disabledReason: markdown === undefined ? "Load the artifact first." : null,
      },
    ],
    "[data-artifact-view]",
  );
  return (
    <ShortcutScope owners={[editOwner, contentOwner]}>
      <>
        {editSection && workflowActions ? (
          <ToolButton
            ref={editTrigger}
            shortcutId="artifact-edit"
            label="Edit"
            onClick={() => workflowActions.onEdit(taskId, { artifactCode: editSection })}
          >
            <Pencil aria-hidden="true" />
          </ToolButton>
        ) : null}
        {markdown !== undefined ? (
          <>
            <DocumentCopyButton
              markdown={markdown}
              dataTestId="copy-artifact-content"
              errorLogContext="TaskArtifacts"
              tooltipSide="bottom"
              className="border-transparent bg-transparent text-foreground hover:bg-accent/60"
            />
            <ToolButton
              ref={expandTrigger}
              shortcutId="content-open"
              label="Expand"
              onClick={() => {
                setModalSnapshot({ title: name, markdown });
                setExpanded(true);
              }}
            >
              <Expand aria-hidden="true" />
            </ToolButton>
          </>
        ) : null}
        {modalPresence && modalSnapshot ? (
          <MarkdownPreviewModal
            open={expanded}
            onOpenChange={setExpanded}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              expandTrigger.current?.focus();
            }}
            title={modalSnapshot.title}
            markdown={modalSnapshot.markdown}
            {...(taskAssetContext ? { taskAssetContext } : {})}
          />
        ) : null}
      </>
    </ShortcutScope>
  );
}

function DownloadButton({
  artifact,
  bytes,
  disabled,
}: {
  artifact: FreeTaskArtifact;
  bytes: Uint8Array;
  disabled: boolean;
}): ReactElement {
  const [source, setSource] = useState<{
    bytes: Uint8Array;
    mediaType: string;
    url: string;
  } | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: artifact.mediaType }),
    );
    setSource({ bytes, mediaType: artifact.mediaType, url: next });
    return () => URL.revokeObjectURL(next);
  }, [artifact.mediaType, bytes]);
  const url =
    source?.bytes === bytes && source.mediaType === artifact.mediaType ? source.url : null;
  const root = useRef<HTMLAnchorElement>(null);
  const shortcutOwner = useLocalShortcuts(
    root,
    [
      {
        id: "content-download" as const,
        run: () => root.current?.click(),
        disabledReason: disabled || !url ? "Download is unavailable." : null,
      },
    ],
    "[data-artifact-view]",
  );
  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" asChild>
            <a
              ref={root}
              href={!disabled && url ? url : undefined}
              download={artifact.fileName}
              aria-disabled={disabled || !url}
              aria-label="Download"
              onClick={(event) => {
                if (disabled || !url) event.preventDefault();
              }}
            >
              <Download aria-hidden="true" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <ShortcutText id="content-download" available={!disabled && Boolean(url)}>
            Download {artifact.fileName}
          </ShortcutText>
        </TooltipContent>
      </Tooltip>
    </ShortcutScope>
  );
}

function ToolButton({
  label,
  shortcutId,
  ...props
}: ComponentProps<typeof Button> & { label: string; shortcutId: ShortcutActionId }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={label}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <ShortcutText id={shortcutId} available={!props.disabled}>
          {label}
        </ShortcutText>
      </TooltipContent>
    </Tooltip>
  );
}
