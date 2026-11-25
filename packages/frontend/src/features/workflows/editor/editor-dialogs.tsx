import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useDialogPresence } from "@/components/ui/dialog";
import { ConfirmDialog, ConfirmSubject } from "@/components/features/confirm/confirm-dialog";
import { ExportWorkflowDialog } from "../library/export-workflow-dialog";
import { useTaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { useDiscardDraft, usePublishWorkflow } from "../use-workflow-library-commands";
import { WORKFLOWS_ROUTE } from "../workflow-routes";
import { type PublishRequest, PublishDialog } from "./dialogs/publish-dialog";
import { VersionsDialog } from "./dialogs/versions-dialog";
import { useEditor, useEditorState } from "./editor-context";

export type EditorDialogName = "publish" | "versions" | "export" | "discard";

type EditorDialogsProps = {
  dialog: EditorDialogName | null;
  onDialogChange: (dialog: EditorDialogName | null) => void;
  latestVersion: number | null;
  /** Reads the document again after a publication or a discard, and seeds a new editor. */
  onReload: () => Promise<void>;
};

/** Publish, Versions, Export, and Discard draft of the open workflow. */
export function EditorDialogs({
  dialog,
  onDialogChange,
  latestVersion,
  onReload,
}: EditorDialogsProps): ReactElement {
  const { store } = useEditor();
  const workflowId = useEditorState((state) => state.workflowId);
  const workflowName = useEditorState((state) => state.document.definition.label);
  const hasDraft = useEditorState((state) => state.hasDraft);
  const navigate = useNavigate();
  const discardDraft = useDiscardDraft();
  const publishWorkflow = usePublishWorkflow();
  const workflowActions = useTaskWorkflowActions();
  const publishMounted = useDialogPresence(dialog === "publish");
  const versionsMounted = useDialogPresence(dialog === "versions");
  const exportMounted = useDialogPresence(dialog === "export");
  const openChange = (name: EditorDialogName) => (open: boolean) =>
    onDialogChange(open ? name : null);

  const discard = () =>
    discardDraft.mutate(
      { workflowId },
      {
        onSuccess: async ({ workflowDeleted }) => {
          onDialogChange(null);
          discardDraft.reset();
          if (workflowDeleted) navigate(WORKFLOWS_ROUTE);
          else await onReload();
        },
      },
    );

  /** A success toast that offers a new task with the workflow when the repository can use it. */
  const published = (message: string, usable: boolean) => {
    if (!usable || !workflowActions) {
      toast.success(message);
      return;
    }
    toast.success(message, {
      description: "New tasks can use it now.",
      duration: 10_000,
      action: {
        label: "Create a task",
        onClick: () => workflowActions.onCreateTask({ workflowId }),
      },
    });
  };

  const publish = async ({ moveTasks, usableHere }: PublishRequest) => {
    // The host publishes its draft, so the last edit saves first.
    await store.getState().saveNow();
    const result = await publishWorkflow.mutateAsync({ workflowId, moveTasks });
    onDialogChange(null);
    if (result.outcome === "problems") {
      store.getState().setHostProblems(result.problems);
      toast.error("The workflow has problems to fix. Nothing was published.");
      return;
    }
    published(`Published version ${result.version}.`, usableHere);
    await onReload();
  };

  const draftOnly = latestVersion === null;
  return (
    <>
      {publishMounted ? (
        <PublishDialog
          open={dialog === "publish"}
          onOpenChange={openChange("publish")}
          workflowId={workflowId}
          latestVersion={latestVersion}
          onPublish={publish}
        />
      ) : null}
      {versionsMounted ? (
        <VersionsDialog
          open={dialog === "versions"}
          onOpenChange={openChange("versions")}
          workflowId={workflowId}
          latestVersion={latestVersion}
        />
      ) : null}
      {exportMounted ? (
        <ExportWorkflowDialog
          open={dialog === "export"}
          onOpenChange={openChange("export")}
          workflowId={workflowId}
          workflowName={workflowName}
          latestVersion={latestVersion}
          hasDraft={hasDraft}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === "discard"}
        onOpenChange={(open) => {
          onDialogChange(open ? "discard" : null);
          if (!open) discardDraft.reset();
        }}
        title={draftOnly ? "Delete workflow" : "Discard draft"}
        description={
          draftOnly
            ? "The workflow has no version yet, so this deletes it."
            : `Go back to version ${latestVersion}.`
        }
        icon={Trash2}
        subject={<ConfirmSubject name={workflowName || workflowId} id={workflowId} />}
        impact={
          draftOnly
            ? { changes: ["Delete the workflow and its draft"], warning: "This cannot be undone." }
            : {
                changes: ["Delete the draft and all its changes"],
                kept: [`Version ${latestVersion} stays as it is`],
                warning: "This cannot be undone.",
              }
        }
        confirmLabel={draftOnly ? "Delete workflow" : "Discard draft"}
        variant="destructive"
        pending={discardDraft.isPending}
        error={discardDraft.error ? errorMessage(discardDraft.error) : null}
        onConfirm={discard}
      />
    </>
  );
}
