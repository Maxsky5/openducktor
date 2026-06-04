import type { DirectoryListing } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, Folder, GitBranch, Home, LoaderCircle, Search } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useReducer } from "react";
import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { errorMessage } from "@/lib/errors";
import { directoryListingQueryOptions } from "@/state/queries/filesystem";

type FolderPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  initialPath?: string;
  requireGitRepo?: boolean;
  onConfirm: (path: string) => Promise<void> | void;
};

type FolderPickerState = {
  requestedPath: string | undefined;
  manualPath: string;
  filterText: string;
  confirmedListing: DirectoryListing | null;
  hasResolvedRequestedPath: boolean;
  submitError: string | null;
  isSubmitting: boolean;
};

type FolderPickerAction =
  | { type: "manualPathChanged"; value: string }
  | { type: "filterTextChanged"; value: string }
  | { type: "directoryRequested"; path: string }
  | { type: "directoryConfirmed"; listing: DirectoryListing }
  | { type: "submitStarted" }
  | { type: "submitFailed"; error: string }
  | { type: "submitFinished" };

const initialFolderPickerState = (initialPath: string | undefined): FolderPickerState => ({
  requestedPath: initialPath,
  manualPath: "",
  filterText: "",
  confirmedListing: null,
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
        submitError: null,
      };
    case "directoryConfirmed":
      return {
        ...state,
        confirmedListing: action.listing,
        hasResolvedRequestedPath: true,
      };
    case "submitStarted":
      return { ...state, submitError: null, isSubmitting: true };
    case "submitFailed":
      return { ...state, submitError: action.error };
    case "submitFinished":
      return { ...state, isSubmitting: false };
  }
};

function FolderPickerDirectoryBrowser({
  confirmedListing,
  filteredEntries,
  filterText,
  status,
  onFilterTextChange,
  onLoadDirectory,
}: {
  confirmedListing: DirectoryListing | null;
  filteredEntries: DirectoryListing["entries"];
  filterText: string;
  status: {
    isBusy: boolean;
    isInitialLoad: boolean;
    isRefreshing: boolean;
  };
  onFilterTextChange: (value: string) => void;
  onLoadDirectory: (path?: string | null) => void;
}): ReactElement {
  const { isBusy, isInitialLoad, isRefreshing } = status;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border p-3">
        <Label htmlFor="folder-picker-filter" className="sr-only">
          Filter directories
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="folder-picker-filter"
            value={filterText}
            placeholder="Search this folder"
            className="pl-9"
            disabled={isBusy || !confirmedListing}
            onChange={(event) => onFilterTextChange(event.currentTarget.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Go to parent folder"
          title="Parent"
          disabled={!confirmedListing?.parentPath || isBusy}
          onClick={() => onLoadDirectory(confirmedListing?.parentPath ?? null)}
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Go to home folder"
          title="Home"
          disabled={!confirmedListing?.homePath || isBusy}
          onClick={() => onLoadDirectory(confirmedListing?.homePath ?? null)}
        >
          <Home className="size-4" />
        </Button>

        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
          <span className="min-w-0 truncate font-mono text-sm text-foreground">
            {confirmedListing?.currentPath ?? "Loading…"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {isRefreshing ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading…
              </span>
            ) : null}
            {confirmedListing?.currentPathIsGitRepo ? (
              <Badge variant="success" className="gap-1 whitespace-nowrap">
                <GitBranch className="size-3" />
                Git repo
              </Badge>
            ) : null}
            {confirmedListing ? (
              <p className="text-xs whitespace-nowrap text-muted-foreground">
                {filteredEntries.length} visible
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <ScrollArea className="h-80">
        <div className="p-1">
          {isInitialLoad ? (
            <div className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading directories…
            </div>
          ) : null}

          {!isInitialLoad && confirmedListing && filteredEntries.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground">
              No directories match this view.
            </div>
          ) : null}

          {filteredEntries.map((entry) => (
            <Button
              key={entry.path}
              type="button"
              variant="ghost"
              className="h-9 w-full justify-between gap-3 rounded-md px-3 text-left"
              disabled={isBusy}
              onClick={() => {
                onLoadDirectory(entry.path);
              }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Folder className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 truncate text-sm text-foreground">{entry.name}</span>
              </span>
              {entry.isGitRepo ? (
                <Badge variant="success" className="shrink-0 gap-1 whitespace-nowrap">
                  <GitBranch className="size-3" />
                  Git repo
                </Badge>
              ) : null}
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

const getFolderPickerSessionKey = ({
  initialPath,
  open,
}: {
  initialPath: string | undefined;
  open: boolean;
}): string => `${open ? "open" : "closed"}\0${initialPath ?? ""}`;

function FolderPickerDialogSession({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialPath,
  requireGitRepo = false,
  onConfirm,
}: FolderPickerDialogProps): ReactElement {
  const [state, dispatch] = useReducer(folderPickerReducer, initialPath, initialFolderPickerState);
  const {
    requestedPath,
    manualPath,
    filterText,
    confirmedListing,
    hasResolvedRequestedPath,
    submitError,
    isSubmitting,
  } = state;

  const directoryQuery = useQuery({
    ...directoryListingQueryOptions(requestedPath),
    enabled: open,
  });

  useEffect(() => {
    if (!directoryQuery.data) {
      return;
    }

    dispatch({ type: "directoryConfirmed", listing: directoryQuery.data });
  }, [directoryQuery.data]);

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
    dispatch({ type: "directoryRequested", path });
  };

  const loadManualPath = (): void => {
    const nextPath = manualPath.trim();
    if (!nextPath) {
      return;
    }

    loadDirectory(nextPath);
  };

  const handleConfirm = async (): Promise<void> => {
    if (!confirmedListing || !hasResolvedRequestedPath) {
      return;
    }

    dispatch({ type: "submitStarted" });
    try {
      await onConfirm(confirmedListing.currentPath);
      onOpenChange(false);
    } catch (error: unknown) {
      dispatch({ type: "submitFailed", error: errorMessage(error) });
    } finally {
      dispatch({ type: "submitFinished" });
    }
  };

  const directoryError = directoryQuery.error ? errorMessage(directoryQuery.error) : null;
  const activeError = submitError ?? directoryError;
  const isInitialLoad = directoryQuery.isPending && !confirmedListing;
  const isRefreshing = directoryQuery.isFetching && Boolean(confirmedListing);
  const isBusy = isSubmitting || isInitialLoad;
  const isCurrentPathSelectable = Boolean(
    confirmedListing &&
      hasResolvedRequestedPath &&
      (!requireGitRepo || confirmedListing.currentPathIsGitRepo),
  );
  const helperMessage =
    requireGitRepo && confirmedListing && !confirmedListing.currentPathIsGitRepo
      ? "Only Git repositories can be opened. Navigate into a repository before continuing."
      : null;
  const canDismiss = !isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!canDismiss && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-4xl px-5 pb-8 pt-6 sm:px-6"
        {...(canDismiss ? {} : { closeButton: null })}
        onEscapeKeyDown={(event) => {
          if (!canDismiss) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (!canDismiss) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="px-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 px-1 pt-4">
          <form
            className="grid gap-2"
            action={() => {
              loadManualPath();
            }}
          >
            <Label htmlFor="folder-picker-manual-path" className="sr-only">
              Open path
            </Label>
            <div className="flex gap-2">
              <Input
                id="folder-picker-manual-path"
                value={manualPath}
                placeholder="/path/to/your/repo"
                className="font-mono"
                disabled={isBusy}
                onChange={(event) =>
                  dispatch({
                    type: "manualPathChanged",
                    value: event.currentTarget.value,
                  })
                }
              />
              <Button
                type="submit"
                variant="outline"
                disabled={isBusy || manualPath.trim().length === 0}
              >
                Load Path
              </Button>
            </div>
          </form>

          <FolderPickerDirectoryBrowser
            confirmedListing={confirmedListing}
            filteredEntries={filteredEntries}
            filterText={filterText}
            status={{ isBusy, isInitialLoad, isRefreshing }}
            onFilterTextChange={(value) => dispatch({ type: "filterTextChanged", value })}
            onLoadDirectory={loadDirectory}
          />

          {helperMessage ? (
            <div className="rounded-md border border-warning-border bg-warning-surface px-3 py-2.5 text-sm text-warning-surface-foreground">
              {helperMessage}
            </div>
          ) : null}

          {activeError ? (
            <div className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
              {activeError}
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-4 justify-between border-t border-border px-1 pt-5">
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!isCurrentPathSelectable || isSubmitting}
            onClick={() => void handleConfirm()}
          >
            {isSubmitting ? "Confirming…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FolderPickerDialog(props: FolderPickerDialogProps): ReactElement {
  return (
    <FolderPickerDialogSession
      key={getFolderPickerSessionKey({ initialPath: props.initialPath, open: props.open })}
      {...props}
    />
  );
}
