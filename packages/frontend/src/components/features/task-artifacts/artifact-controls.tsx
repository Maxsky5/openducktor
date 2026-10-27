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
  const expandTrigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [modalSnapshot, setModalSnapshot] = useState<TaskArtifactContent | null>(null);
  const modalPresence = useDialogPresence(expanded);
  return (
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
              <Button
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
              </Button>
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
  const [expanded, setExpanded] = useState(false);
  const [modalSnapshot, setModalSnapshot] = useState<{ title: string; markdown: string } | null>(
    null,
  );
  const modalPresence = useDialogPresence(expanded);
  const editSection = isEditableWorkflowDocument(workflowCode) ? workflowCode : null;
  return (
    <>
      {editSection && workflowActions ? (
        <ToolButton label="Edit" onClick={() => workflowActions.onEdit(taskId, editSection)}>
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
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" asChild>
          <a
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
      <TooltipContent side="bottom">Download {artifact.fileName}</TooltipContent>
    </Tooltip>
  );
}

function ToolButton({
  label,
  ...props
}: ComponentProps<typeof Button> & { label: string }): ReactElement {
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
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
