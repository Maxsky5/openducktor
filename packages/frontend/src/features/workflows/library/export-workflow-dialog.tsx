import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workflowExportQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, FileText } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { cn } from "@/lib/utils";
import { WORKFLOW_DIALOG } from "../workflow-dialog";

/** A Blob URL of the text that lives while the text shows. */
const useTextFileUrl = (text: string | undefined): string | null => {
  const [url, setUrl] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    if (text === undefined) return;
    const next = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
    setUrl({ text, url: next });
    return () => URL.revokeObjectURL(next);
  }, [text]);
  return url !== null && url.text === text ? url.url : null;
};

/**
 * The YAML file of the latest version, with Save file and Copy. The file holds no draft, so the
 * dialog says when the draft has changes that the file does not have.
 */
export function ExportWorkflowDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  latestVersion,
  hasDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workflowName: string;
  latestVersion: number | null;
  hasDraft: boolean;
}): ReactElement {
  const query = useQuery({ ...workflowExportQueryOptions(workflowId), enabled: open });
  const file = query.data;
  const url = useTextFileUrl(file?.text);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.text);
      setCopyError(null);
      setCopied(true);
    } catch (cause) {
      setCopyError(`The text could not be copied. ${errorMessage(cause)}`);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={WORKFLOW_DIALOG.lg}
        loading={query.isPending}
        loadingLabel="Reading the workflow file"
      >
        <DialogHeader className={WORKFLOW_DIALOG.header}>
          <DialogTitle>Export {workflowName}</DialogTitle>
          <DialogDescription>
            Share this file and import it in another OpenDucktor. It holds{" "}
            {latestVersion === null ? "the latest version" : `version ${latestVersion}`}, its
            prompts, the custom roles that it uses, and the canvas layout. It holds no settings,
            tasks, or version history.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-2")}>
          {hasDraft ? (
            <p className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-surface-foreground">
              The draft has unpublished changes, and the file does not hold them. Publish the draft
              to export them.
            </p>
          ) : null}
          {query.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(query.error)}</AlertDescription>
            </Alert>
          ) : null}
          {file ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="font-mono">{file.fileName}</span>
              </p>
              <pre
                aria-label="Workflow file"
                // A keyboard user scrolls the file with the arrow keys.
                tabIndex={0}
                className="max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {file.text}
              </pre>
            </>
          ) : null}
          {copyError ? (
            <Alert variant="destructive">
              <AlertDescription>{copyError}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter className={WORKFLOW_DIALOG.footer}>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={!file} onClick={() => void copy()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button asChild disabled={!file || !url}>
              <a
                href={file && url ? url : undefined}
                download={file?.fileName}
                aria-disabled={!file || !url}
                onClick={(event) => {
                  if (!file || !url) event.preventDefault();
                }}
              >
                <Download className="size-4" />
                Save file
              </a>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
