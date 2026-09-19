import type { DirectoryListing } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer } from "react";
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
  selectedFilePath: string | null;
  submitError: string | null;
  isSubmitting: boolean;
};

type FolderPickerAction =
  | { type: "manualPathChanged"; value: string }
  | { type: "filterTextChanged"; value: string }
  | { type: "directoryRequested"; path: string }
  | { type: "fileSelected"; path: string }
  | { type: "fileSelectionCleared" }
  | { type: "submitStarted" }
  | { type: "submitFailed"; error: string }
  | { type: "submitFinished" };

const initialFolderPickerState = (initialPath: string | undefined): FolderPickerState => ({
  requestedPath: initialPath,
  manualPath: "",
  filterText: "",
  selectedFilePath: null,
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
        selectedFilePath: null,
        submitError: null,
      };
    case "fileSelected":
      return { ...state, selectedFilePath: action.path, submitError: null };
    case "fileSelectionCleared":
      return { ...state, selectedFilePath: null };
    case "submitStarted":
      return { ...state, submitError: null, isSubmitting: true };
    case "submitFailed":
      return { ...state, submitError: action.error };
    case "submitFinished":
      return { ...state, isSubmitting: false };
  }
};

const listingContainsFile = (
  listing: DirectoryListing | null,
  selectedFilePath: string | null,
): boolean =>
  Boolean(
    selectedFilePath &&
    listing?.entries.some((entry) => !entry.isDirectory && entry.path === selectedFilePath),
  );

const filterListingEntries = (
  listing: DirectoryListing | null,
  filterText: string,
): DirectoryListing["entries"] => {
  if (!listing) {
    return [];
  }

  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  if (!normalizedFilter) {
    return listing.entries;
  }

  return listing.entries.filter((entry) => {
    return (
      entry.name.toLocaleLowerCase().includes(normalizedFilter) ||
      entry.path.toLocaleLowerCase().includes(normalizedFilter)
    );
  });
};

const canSelectListing = ({
  hasVerifiedDirectory,
  listing,
  requireGitRepo,
  selectedFilePath,
  selectionMode,
}: {
  hasVerifiedDirectory: boolean;
  listing: DirectoryListing | null;
  requireGitRepo: boolean;
  selectedFilePath: string | null;
  selectionMode: "directory" | "file";
}): boolean =>
  Boolean(
    hasVerifiedDirectory &&
    listing &&
    (selectionMode === "file" ? selectedFilePath : !requireGitRepo || listing.currentPathIsGitRepo),
  );

const getFolderPickerHelperMessage = (
  listing: DirectoryListing | null,
  requireGitRepo: boolean,
): string | null => {
  if (!requireGitRepo || !listing || listing.currentPathIsGitRepo) {
    return null;
  }

  return "Only Git repositories can be opened. Navigate into a repository before continuing.";
};

export type FolderPickerController = {
  requestedPath: string | undefined;
  manualPath: string;
  filterText: string;
  listing: DirectoryListing | null;
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
  const { requestedPath, manualPath, filterText, selectedFilePath, submitError, isSubmitting } =
    state;

  const directoryQuery = useQuery({
    ...directoryListingQueryOptions(requestedPath, undefined, selectionMode === "file"),
    enabled: open,
  });
  const listing = directoryQuery.data ?? null;
  const selectedFileStillExists = listingContainsFile(listing, selectedFilePath);
  const currentSelectedFilePath = selectedFileStillExists ? selectedFilePath : null;

  useEffect(() => {
    if (!selectedFilePath || !listing || selectedFileStillExists) {
      return;
    }

    dispatch({ type: "fileSelectionCleared" });
  }, [listing, selectedFilePath, selectedFileStillExists]);

  const isInitialLoad = directoryQuery.isPending && !listing;
  const isRefreshing = directoryQuery.isFetching && Boolean(listing);
  const directoryError = directoryQuery.error ? errorMessage(directoryQuery.error) : null;
  const hasVerifiedDirectory = Boolean(
    listing && directoryQuery.isSuccess && !directoryQuery.isFetching && !directoryQuery.error,
  );

  const filteredEntries = useMemo(
    () => filterListingEntries(listing, filterText),
    [listing, filterText],
  );

  const loadDirectory = (path?: string | null): void => {
    if (!path) {
      return;
    }
    if (path === requestedPath) {
      void directoryQuery.refetch();
      return;
    }
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
    if (!listing || !hasVerifiedDirectory) {
      return;
    }

    const selectedPath = selectionMode === "file" ? currentSelectedFilePath : listing.currentPath;
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

  const activeError = submitError ?? directoryError;
  const isBusy = isSubmitting || isInitialLoad;
  const isCurrentPathSelectable = canSelectListing({
    hasVerifiedDirectory,
    listing,
    requireGitRepo,
    selectedFilePath: currentSelectedFilePath,
    selectionMode,
  });
  const helperMessage = getFolderPickerHelperMessage(listing, requireGitRepo);

  return {
    requestedPath,
    manualPath,
    filterText,
    listing,
    selectedFilePath: currentSelectedFilePath,
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
