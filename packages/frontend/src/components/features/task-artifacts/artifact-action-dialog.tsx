import {
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type ArtifactSaveResult,
  type ArtifactDeleteResult,
  type FreeTaskArtifact,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useHostClient } from "@openducktor/frontend-core";
import { createArtifactSaveGuard } from "@openducktor/frontend-core/queries/artifacts";
import { useQueryClient } from "@tanstack/react-query";
import { File as FileIcon, LoaderCircle, Upload } from "lucide-react";
import { type FormEvent, type ReactElement, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFileSize } from "@openducktor/frontend-core/tasks/artifacts/artifact-presentation";
import { artifactFileInput } from "./artifact-file-input";

export type ArtifactAction =
  | { kind: "create" }
  | { kind: "rename" | "replace" | "delete"; artifact: FreeTaskArtifact };

const actionLabels = {
  create: { title: "Add artifact", submit: "Add artifact", pending: "Adding..." },
  rename: { title: "Rename artifact", submit: "Rename", pending: "Renaming..." },
  replace: {
    title: "Replace artifact content",
    submit: "Replace content",
    pending: "Replacing...",
  },
  delete: { title: "Delete artifact", submit: "Delete artifact", pending: "Deleting..." },
};

export function ArtifactActionDialog({
  action,
  repoPath,
  taskId,
  canManage,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  action: ArtifactAction;
  repoPath: string;
  taskId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): ReactElement {
  const host = useHostClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(action.kind === "create" ? "" : action.artifact.name);
  const [file, setFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = actionLabels[action.kind];
  const isFileTooLarge = file !== null && file.size > TASK_ARTIFACT_MAX_FILE_BYTES;
  const canSubmit = canManage && !isSaving && !isFileTooLarge && isFormComplete(action, name, file);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);
    const accept = createArtifactSaveGuard(queryClient, repoPath, taskId);
    try {
      await accept(await saveChange(host, { repoPath, taskId }, action, name, file));
      onOpenChange(false);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The artifact change failed. Try again.";
      setError(
        message === "Failed to fetch"
          ? "Cannot reach the host. Check your host connection and try again."
          : message,
      );
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!isSaving) onOpenChange(value);
      }}
    >
      <DialogContent
        className="p-0 sm:max-w-md"
        closeButton={isSaving ? null : undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="flex min-h-0 min-w-0 flex-col"
          aria-busy={isSaving}
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>
              <span className="[overflow-wrap:anywhere]">{actionDescription(action)}</span>
            </DialogDescription>
          </DialogHeader>
          <fieldset
            disabled={isSaving}
            className="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
          >
            <DialogBody className="flex min-w-0 flex-col gap-4 px-5 py-4">
              {action.kind === "replace" || action.kind === "delete" ? (
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    {action.kind === "replace" ? "Current artifact" : "Artifact to delete"}
                  </p>
                  <p
                    className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]"
                    title={action.artifact.name}
                  >
                    {action.artifact.name}
                  </p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={action.artifact.fileName}
                  >
                    {action.artifact.fileName}
                  </p>
                </div>
              ) : null}
              {!canManage ? (
                <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
                  Artifact changes are unavailable. Close this dialog and check the task status or
                  connection.
                </p>
              ) : null}
              <ActionFields
                action={action}
                disabled={!canManage}
                name={name}
                file={file}
                isFileTooLarge={isFileTooLarge}
                onNameChange={setName}
                onFileChange={(selected) => {
                  if (!selected) return;
                  if (action.kind === "create") {
                    setName((current) =>
                      !current.trim() || current === file?.name ? selected.name : current,
                    );
                  }
                  setFile(selected);
                  setError(null);
                }}
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
                  {error}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter className="mt-0 justify-between border-t border-border px-5 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={action.kind === "delete" ? "destructive" : "default"}
                disabled={!canSubmit}
              >
                {isSaving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                {isSaving ? labels.pending : labels.submit}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function actionDescription(action: ArtifactAction): string {
  switch (action.kind) {
    case "create":
      return "Attach a file to this task.";
    case "rename":
      return "Change the display name shown in this task.";
    case "replace":
      return "Choose a new file. The display name stays the same.";
    case "delete":
      return "Delete this artifact? This cannot be undone.";
  }
}

function isFormComplete(action: ArtifactAction, name: string, file: File | null): boolean {
  switch (action.kind) {
    case "create":
      return file !== null && Boolean(name.trim());
    case "rename":
      return Boolean(name.trim());
    case "replace":
      return file !== null;
    case "delete":
      return true;
  }
}

async function saveChange(
  host: HostClient,
  scope: { repoPath: string; taskId: string },
  action: ArtifactAction,
  name: string,
  file: File | null,
): Promise<ArtifactSaveResult | ArtifactDeleteResult> {
  if (action.kind === "delete")
    return host.taskArtifactDelete({ ...scope, artifactId: action.artifact.artifactId });
  if (action.kind === "rename")
    return host.taskArtifactRename({ ...scope, artifactId: action.artifact.artifactId, name });
  if (!file) throw new Error("Select a file to save.");
  const content = await artifactFileInput(file);
  return action.kind === "create"
    ? host.taskArtifactCreate({ ...scope, ...content, name })
    : host.taskArtifactReplace({ ...scope, ...content, artifactId: action.artifact.artifactId });
}

function ActionFields({
  action,
  disabled,
  name,
  file,
  isFileTooLarge,
  onNameChange,
  onFileChange,
}: {
  action: ArtifactAction;
  disabled: boolean;
  name: string;
  file: File | null;
  isFileTooLarge: boolean;
  onNameChange: (name: string) => void;
  onFileChange: (file: File | null) => void;
}): ReactElement {
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      {action.kind === "create" || action.kind === "replace" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${fieldId}-file`}>
            {action.kind === "replace" ? "New file" : "File"}
          </Label>
          <input
            ref={fileInput}
            id={`${fieldId}-file`}
            type="file"
            className="sr-only"
            tabIndex={-1}
            disabled={disabled}
            aria-invalid={isFileTooLarge}
            aria-describedby={`${fieldId}-file-help`}
            onChange={(event) => {
              onFileChange(event.currentTarget.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          {file ? (
            <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <FileIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                Change
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-5">
              <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
                aria-describedby={`${fieldId}-file-help`}
              >
                Choose file
              </Button>
            </div>
          )}
          <p id={`${fieldId}-file-help`} className="text-xs text-muted-foreground">
            Any file format, up to 10 MiB.
          </p>
          {isFileTooLarge ? (
            <p role="alert" className="text-sm text-destructive">
              This file exceeds the 10 MiB limit. Choose a smaller file.
            </p>
          ) : null}
        </div>
      ) : null}
      {action.kind === "create" || action.kind === "rename" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${fieldId}-name`}>Display name</Label>
          <Input
            id={`${fieldId}-name`}
            value={name}
            maxLength={255}
            required
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
        </div>
      ) : null}
    </>
  );
}
