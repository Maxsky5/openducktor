import type { DirectoryListing } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import { directoryListingQueryOptions } from "@/state/queries/filesystem";

export type FolderPickerCommonProps = {
  title: string;
  description: string;
  confirmLabel: string;
  initialPath?: string;
  requireGitRepo?: boolean;
  selectionMode?: "directory" | "file";
  onConfirm: (path: string) => Promise<void> | void;
};

type FolderPickerState = {
  requestedPath: string | undefined;
  manualPath: string;
  filterText: string;
  confirmedListing: DirectoryListing | null;
  selectedFilePath: string | null;
  hasResolvedRequestedPath: boolean;
  submitError: string | null;
  isSubmitting: boolean;
};

type FolderPickerAction =
  | { type: "manualPathChanged"; value: string }
  | { type: "filterTextChanged"; value: string }
  | { type: "directoryRequested"; path: string }
  | { type: "directoryConfirmed"; listing: DirectoryListing }
  | { type: "fileSelected"; path: string }
  | { type: "submitStarted" }
  | { type: "submitFailed"; error: string }
  | { type: "submitFinished" };

const initialFolderPickerState = (initialPath: string | undefined): FolderPickerState => ({
  requestedPath: initialPath,
  manualPath: "",
  filterText: "",
  confirmedListing: null,
  selectedFilePath: null,
  hasResolvedRequestedPath: false,
  submitError: null,
  isSubmitting: false,
});

const folderPickerReducer = (
  state: FolderPickerState,
  action: FolderPickerAction,
): FolderPickerState => {
  switch (action.type) {
    case "manualPathChanged":
      return { ...state, manualPath: action.value };
    case "filterTextChanged":
      return { ...state, filterText: action.value };
    case "directoryRequested":
      return {
        ...state,
        requestedPath: action.path,
        filterText: "",
        hasResolvedRequestedPath: false,
        selectedFilePath: null,
        submitError: null,
      };
    case "directoryConfirmed": {
      const selectedFileStillExists = action.listing.entries.some(
        (entry) => !entry.isDirectory && entry.path === state.selectedFilePath,
      );
      return {
        ...state,
        confirmedListing: action.listing,
        selectedFilePath:
          state.hasResolvedRequestedPath && selectedFileStillExists ? state.selectedFilePath : null,
        hasResolvedRequestedPath: true,
      };
    }
    case "fileSelected":
      if (!state.hasResolvedRequestedPath) {
        return state;
      }
      return { ...state, selectedFilePath: action.path, submitError: null };
    case "submitStarted":
      return { ...state, submitError: null, isSubmitting: true };
    case "submitFailed":
      return { ...state, submitError: action.error };
    case "submitFinished":
      return { ...state, isSubmitting: false };
  }
};

export type FolderPickerController = {
  manualPath: string;
  filterText: string;
  confirmedListing: DirectoryListing | null;
  selectedFilePath: string | null;
  filteredEntries: DirectoryListing["entries"];
  activeError: string | null;
  helperMessage: string | null;
  isSubmitting: boolean;
  isInitialLoad: boolean;
  isRefreshing: boolean;
  isBusy: boolean;
  isCurrentPathSelectable: boolean;
  canDismiss: boolean;
  selectionMode: "directory" | "file";
  loadManualPath: () => void;
  loadDirectory: (path?: string | null) => void;
  confirm: () => Promise<void>;
  close: () => void;
  changeManualPath: (value: string) => void;
  changeFilterText: (value: string) => void;
  selectFile: (path: string) => void;
};

export function useFolderPickerController({
  open,
  onOpenChange,
  initialPath,
  requireGitRepo,
  selectionMode,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath: string | undefined;
  requireGitRepo: boolean;
  selectionMode: "directory" | "file";
  onConfirm: (path: string) => Promise<void> | void;
}): FolderPickerController {
  const [state, dispatch] = useReducer(folderPickerReducer, initialPath, initialFolderPickerState);
  const requestedPathRef = useRef(initialPath);
  const {
    requestedPath,
    manualPath,
    filterText,
    confirmedListing,
    selectedFilePath,
    hasResolvedRequestedPath,
    submitError,
    isSubmitting,
  } = state;

  const directoryQuery = useQuery({
    ...directoryListingQueryOptions(requestedPath, undefined, selectionMode === "file"),
    enabled: open,
  });

  useEffect(() => {
    if (!directoryQuery.data) {
      return;
    }

    dispatch({ type: "directoryConfirmed", listing: directoryQuery.data });
  }, [directoryQuery.data]);

  const isInitialLoad = directoryQuery.isPending && !confirmedListing;
  const isRefreshing = directoryQuery.isFetching && Boolean(confirmedListing);

  const filteredEntries = useMemo(() => {
    if (!confirmedListing) {
      return [];
    }

    const normalizedFilter = filterText.trim().toLocaleLowerCase();
    if (!normalizedFilter) {
      return confirmedListing.entries;
    }

    return confirmedListing.entries.filter((entry) => {
      return (
        entry.name.toLocaleLowerCase().includes(normalizedFilter) ||
        entry.path.toLocaleLowerCase().includes(normalizedFilter)
      );
    });
  }, [confirmedListing, filterText]);

  const loadDirectory = (path?: string | null): void => {
    if (!path) {
      return;
    }
    if (path === requestedPath) {
      void directoryQuery.refetch().then(({ data }) => {
        if (data && requestedPathRef.current === path) {
          dispatch({ type: "directoryConfirmed", listing: data });
        }
      });
      return;
    }
    requestedPathRef.current = path;
    dispatch({ type: "directoryRequested", path });
  };

  const loadManualPath = (): void => {
    const nextPath = manualPath.trim();
    if (!nextPath) {
      return;
    }

    loadDirectory(nextPath);
  };

  const confirm = async (): Promise<void> => {
    if (!confirmedListing || !hasResolvedRequestedPath || isRefreshing) {
      return;
    }

    const selectedPath = selectionMode === "file" ? selectedFilePath : confirmedListing.currentPath;
    if (!selectedPath) return;

    dispatch({ type: "submitStarted" });
    try {
      await onConfirm(selectedPath);
      onOpenChange(false);
    } catch (error: unknown) {
      dispatch({ type: "submitFailed", error: errorMessage(error) });
    } finally {
      dispatch({ type: "submitFinished" });
    }
  };

  const directoryError = directoryQuery.error ? errorMessage(directoryQuery.error) : null;
  const activeError = submitError ?? directoryError;
  const isBusy = isSubmitting || isInitialLoad;
  const isCurrentPathSelectable = Boolean(
    confirmedListing &&
      hasResolvedRequestedPath &&
      !isRefreshing &&
      (selectionMode === "file"
        ? selectedFilePath
        : !requireGitRepo || confirmedListing.currentPathIsGitRepo),
  );
  const helperMessage =
    requireGitRepo && confirmedListing && !confirmedListing.currentPathIsGitRepo
      ? "Only Git repositories can be opened. Navigate into a repository before continuing."
      : null;

  return {
    manualPath,
    filterText,
    confirmedListing,
    selectedFilePath,
    filteredEntries,
    activeError,
    helperMessage,
    isSubmitting,
    isInitialLoad,
    isRefreshing,
    isBusy,
    isCurrentPathSelectable,
    canDismiss: !isSubmitting,
    selectionMode,
    loadManualPath,
    loadDirectory,
    confirm,
    close: () => onOpenChange(false),
    changeManualPath: (value) => dispatch({ type: "manualPathChanged", value }),
    changeFilterText: (value) => dispatch({ type: "filterTextChanged", value }),
    selectFile: (path) => dispatch({ type: "fileSelected", path }),
  };
}
