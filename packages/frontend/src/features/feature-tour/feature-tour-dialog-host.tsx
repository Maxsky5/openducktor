import { lazy, type ReactElement, Suspense } from "react";
import { useDialogPresence } from "@/components/ui/dialog";
import { useFeatureTourState } from "./feature-tour-context";
import { loadFeatureTourDialog } from "./feature-tour-dialog-loader";

const FeatureTourDialog = lazy(() =>
  loadFeatureTourDialog().then((module) => ({ default: module.FeatureTourDialog })),
);

/** Mounts the tour while it is open or closing. Mount it inside `TaskWorkflowActionsProvider`. */
export function FeatureTourDialogHost(): ReactElement | null {
  const { open } = useFeatureTourState();
  const mounted = useDialogPresence(open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <FeatureTourDialog />
    </Suspense>
  );
}
