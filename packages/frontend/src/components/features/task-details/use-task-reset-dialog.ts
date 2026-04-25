import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";

type UseTaskResetDialogOptions = {
  sheetOpen: boolean;
  task: TaskCard | null;
  onOpenChange: (open: boolean) => void;
  onResetTask: ((taskId: string) => Promise<void>) | undefined;
};

export function useTaskResetDialog({
  sheetOpen,
  task,
  onOpenChange,
  onResetTask,
}: UseTaskResetDialogOptions): {
  isResetDialogOpen: boolean;
  isResetPending: boolean;
  resetError: string | null;
  openResetDialog: () => void;
  closeResetDialog: () => void;
  handleResetDialogOpenChange: (nextOpen: boolean) => void;
  confirmReset: () => void;
} {
  const [isResetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetRequestInFlightRef = useRef(false);

  useEffect(() => {
    if (!sheetOpen) {
      setResetDialogOpen(false);
      setResetError(null);
      if (!resetRequestInFlightRef.current) {
        setIsResetting(false);
      }
    }
  }, [sheetOpen]);

  const openResetDialog = useCallback((): void => {
    setResetError(null);
    setResetDialogOpen(true);
  }, []);

  const closeResetDialog = useCallback((): void => {
    if (resetRequestInFlightRef.current) {
      return;
    }
    setResetDialogOpen(false);
    setResetError(null);
  }, []);

  const handleResetDialogOpenChange = useCallback((nextOpen: boolean): void => {
    if (resetRequestInFlightRef.current) {
      return;
    }

    setResetDialogOpen(nextOpen);
    if (!nextOpen) {
      setResetError(null);
    }
  }, []);

  const confirmReset = useCallback((): void => {
    if (!task || !onResetTask || resetRequestInFlightRef.current) {
      return;
    }

    resetRequestInFlightRef.current = true;
    setIsResetting(true);
    setResetError(null);

    void onResetTask(task.id)
      .then(() => {
        setResetDialogOpen(false);
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        setResetError(errorMessage(error));
      })
      .finally(() => {
        resetRequestInFlightRef.current = false;
        setIsResetting(false);
      });
  }, [onOpenChange, onResetTask, task]);

  return {
    isResetDialogOpen,
    isResetPending: isResetting || resetRequestInFlightRef.current,
    resetError,
    openResetDialog,
    closeResetDialog,
    handleResetDialogOpenChange,
    confirmReset,
  };
}
