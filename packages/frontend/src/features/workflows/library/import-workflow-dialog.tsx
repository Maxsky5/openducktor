import { WORKFLOW_FILE_FORMAT_VERSION, type WorkflowImportPreview } from "@openducktor/contracts";
import { FileUp, FolderOpen, Loader2, ScanSearch } from "lucide-react";
import { type ReactElement, useId, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  commandStatus,
  useImportWorkflow,
  usePreviewImport,
} from "../use-workflow-library-commands";
import { WORKFLOW_DIALOG } from "../workflow-dialog";
import { invalidLocation } from "./import-location";
import { ImportSummary, type RoleChoice, type Target } from "./import-summary";

const YAML_PLACEHOLDER = `# Example
formatVersion: ${WORKFLOW_FILE_FORMAT_VERSION}
workflow:
  id: design-review
  label: Design review
  …`;

/** A file button with the chosen file name, and the YAML text that a paste can fill. */
function ImportSource({
  text,
  disabled,
  onText,
  onFile,
}: {
  text: string;
  disabled: boolean;
  onText: (text: string) => void;
  /** The text of a chosen file. */
  onFile: (text: string) => void;
}): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <>
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,application/yaml,text/yaml"
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setFileName(file.name);
            onFile(await file.text());
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <FolderOpen className="size-4" />
          Choose a file
        </Button>
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            fileName ? "font-mono text-foreground" : "text-muted-foreground",
          )}
        >
          {fileName ?? "No file chosen. You can also paste the text below."}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={textId}>YAML text</Label>
        <Textarea
          id={textId}
          value={text}
          rows={10}
          disabled={disabled}
          placeholder={YAML_PLACEHOLDER}
          spellCheck={false}
          className="resize-none font-mono text-xs leading-5 placeholder:text-muted-foreground/60"
          onChange={(event) => {
            onText(event.currentTarget.value);
            setFileName(null);
          }}
        />
      </div>
    </>
  );
}

/** Imports a workflow from a YAML file or pasted text, then opens the new draft. */
export function ImportWorkflowDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (workflowId: string) => void;
}): ReactElement {
  const previewImport = usePreviewImport();
  const importWorkflow = useImportWorkflow();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ text: string; result: WorkflowImportPreview } | null>(
    null,
  );
  const [target, setTarget] = useState<Target>("new");
  const [roleChoices, setRoleChoices] = useState<Record<string, RoleChoice>>({});
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const { pending, error } = commandStatus(previewImport, importWorkflow);
  const current = preview?.text === text ? preview.result : null;
  const ready = current?.outcome === "ready" ? current : null;
  const needsReplaceConfirmation = ready !== null && target === "update" && ready.existingDraft;

  const runPreview = (value: string) => {
    importWorkflow.reset();
    previewImport.mutate(
      { text: value },
      {
        onSuccess: (result) => {
          setPreview({ text: value, result });
          setTarget(result.outcome === "ready" && result.match === "custom" ? "update" : "new");
          setRoleChoices({});
          setReplaceConfirmed(false);
        },
      },
    );
  };

  const runImport = () => {
    if (!ready) return;
    const choices: Record<string, RoleChoice> = {};
    for (const role of ready.roles)
      if (role.status === "conflict") choices[role.id] = roleChoices[role.id] ?? "host";
    importWorkflow.mutate(
      { text, target, roleChoices: choices },
      {
        onSuccess: ({ workflowId }) => {
          onOpenChange(false);
          onImported(workflowId);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className={WORKFLOW_DIALOG.lg}>
        <DialogHeader className={WORKFLOW_DIALOG.header}>
          <DialogTitle>Import a workflow</DialogTitle>
          <DialogDescription>
            Pick a workflow YAML file or paste its text. The import saves a draft and opens it. When
            you already have a workflow with the same ID, you choose to update it or to import a
            copy.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-4")}>
          <ImportSource
            text={text}
            disabled={pending}
            onText={setText}
            onFile={(value) => {
              setText(value);
              runPreview(value);
            }}
          />
          {current?.outcome === "invalid" ? (
            <Alert variant="destructive">
              <div>
                <AlertTitle>The text cannot be imported</AlertTitle>
                <AlertDescription>
                  {current.message}
                  {invalidLocation(current)}
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          {ready ? (
            <ImportSummary
              preview={ready}
              target={target}
              onTarget={setTarget}
              roleChoices={roleChoices}
              onRoleChoice={(roleId, choice) =>
                setRoleChoices((choices) => ({ ...choices, [roleId]: choice }))
              }
              replaceConfirmed={replaceConfirmed}
              onReplaceConfirmed={setReplaceConfirmed}
              disabled={pending}
            />
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter className={WORKFLOW_DIALOG.footer}>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {ready ? (
            <Button
              type="button"
              disabled={pending || (needsReplaceConfirmation && !replaceConfirmed)}
              onClick={() => runImport()}
            >
              {importWorkflow.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              Import draft
            </Button>
          ) : (
            <Button
              type="button"
              disabled={pending || text.trim().length === 0}
              onClick={() => runPreview(text)}
            >
              {previewImport.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ScanSearch className="size-4" />
              )}
              Check
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
