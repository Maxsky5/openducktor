import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type ReactElement, useState } from "react";
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
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/host";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import { useMountedRef } from "./use-mounted-ref";

type Props = {
  open: boolean;
  workspaceId: string;
  record: WorkspaceSession;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function WorkspaceSessionRenameDialog({
  open,
  workspaceId,
  record,
  onClose,
  onCloseAutoFocus,
}: Props): ReactElement {
  const queryClient = useQueryClient();
  const mounted = useMountedRef();
  const initialTitle = record.manualTitle ?? record.generatedTitle ?? "";
  const [draft, setDraft] = useState(initialTitle);
  const rename = useMutation({
    mutationFn: (manualTitle: string) =>
      host.workspaceSessionRename({ workspaceId, sessionId: record.id, manualTitle }),
    onSuccess: (session) => {
      updateWorkspaceSessionQueries(queryClient, workspaceId, session);
      if (mounted.current) onClose();
    },
  });
  const canSave = draft.trim() !== initialTitle && !rename.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !rename.isPending) onClose();
      }}
    >
      <DialogContent
        className="p-0 sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
        closeButton={rename.isPending ? null : undefined}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) rename.mutate(draft.trim());
          }}
        >
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Leave the name blank to use the generated title.</DialogDescription>
          </DialogHeader>
          <fieldset
            disabled={rename.isPending}
            className="flex min-h-0 flex-1 flex-col border-0 p-0"
          >
            <DialogBody className="flex flex-col gap-1.5 px-5 py-4">
              <Label htmlFor="workspace-session-rename">Name</Label>
              <Input
                id="workspace-session-rename"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={WORKSPACE_SESSION_MANUAL_TITLE_LIMIT}
                autoComplete="off"
              />
              {rename.error && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(rename.error)}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="mt-0 justify-between border-t border-border px-5 py-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {rename.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {rename.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
