import { LogOut } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  type RouteLeaveGuard,
  useRouteLeaveGuard,
} from "@/components/layout/workspace-preview-transition-guard";
import { ConfirmDialog } from "@/components/features/confirm/confirm-dialog";
import { workflowPath } from "../workflow-routes";
import type { EditorStore } from "./model/editor-store";

/**
 * Holds a route change that leaves the editor while a draft save waits or runs, and lets it go
 * when the save ends. It asks only when a save failed, because the change is only in the editor
 * until the host saves it. The route change of a draft-only workflow rename goes to the saved
 * workflow ID, so it passes.
 */
export function UnsavedDraftGuard({ store }: { store: EditorStore }): ReactElement {
  const save = useStore(store, (state) => state.save);
  const [pending, setPending] = useState<{ proceed: () => void; reset: () => void } | null>(null);
  const guard = useMemo(
    (): RouteLeaveGuard => ({
      blocks: (current, next) => {
        const { save: status, workflowId } = store.getState();
        return (
          status.status !== "saved" &&
          next.pathname !== current.pathname &&
          next.pathname !== workflowPath(workflowId)
        );
      },
      ask: (proceed, reset) => {
        const state = store.getState();
        if (state.save.status === "failed") {
          setPending({ proceed, reset });
          return;
        }
        // The last edit saves now. The change of route waits for the save store event.
        state.flushSave();
        const unsubscribe = store.subscribe(({ save }) => {
          if (save.status === "saving") return;
          unsubscribe();
          if (save.status === "saved") proceed();
          else setPending({ proceed, reset });
        });
      },
    }),
    [store],
  );
  useRouteLeaveGuard(guard);
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (open || !pending) return;
        pending.reset();
        setPending(null);
      }}
      title="Leave the editor"
      description="The last change did not save."
      icon={LogOut}
      impact={{
        changes: ["Lose the last change"],
        warning:
          save.status === "failed"
            ? `It did not save: ${save.message} Stay to retry it.`
            : "Stay to keep it.",
      }}
      confirmLabel="Leave"
      variant="destructive"
      pending={false}
      error={null}
      onConfirm={() => {
        // The last edit saves now, so it does not wait for the autosave pause.
        store.getState().flushSave();
        pending?.proceed();
        setPending(null);
      }}
    />
  );
}
