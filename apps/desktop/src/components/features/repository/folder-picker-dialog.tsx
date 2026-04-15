import type { DirectoryListing } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, Folder, GitBranch, Home, LoaderCircle, Search } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
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

export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialPath,
  requireGitRepo = false,
  onConfirm,
}: FolderPickerDialogProps): ReactElement {
  const [requestedPath, setRequestedPath] = useState<string | undefined>(initialPath);
  const [manualPath, setManualPath] = useState("");
  const [filterText, setFilterText] = useState("");
  const [confirmedListing, setConfirmedListing] = useState<DirectoryListing | null>(null);
  const [hasResolvedRequestedPath, setHasResolvedRequestedPath] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmedListing(null);
      setHasResolvedRequestedPath(false);
      setSubmitError(null);
      return;
    }

    setRequestedPath(initialPath);
    setManualPath("");
    setFilterText("");
    setHasResolvedRequestedPath(false);
    setSubmitError(null);
  }, [initialPath, open]);

  const directoryQuery = useQuery({
    ...directoryListingQueryOptions(requestedPath),
    enabled: open,
  });

  useEffect(() => {
    if (!directoryQuery.data) {
      return;
    }

    setConfirmedListing(directoryQuery.data);
    setHasResolvedRequestedPath(true);
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
    setSubmitError(null);
    setHasResolvedRequestedPath(false);
    setRequestedPath(path);
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

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(confirmedListing.currentPath);
      onOpenChange(false);
    } catch (error: unknown) {
      setSubmitError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
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
            onSubmit={(event) => {
              event.preventDefault();
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
                onChange={(event) => setManualPath(event.currentTarget.value)}
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

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-3 py-3">
              <Label htmlFor="folder-picker-filter" className="sr-only">
                Filter directories
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="folder-picker-filter"
                  value={filterText}
                  placeholder="Search this folder"
                  className="pl-9"
                  disabled={isBusy || !confirmedListing}
                  onChange={(event) => setFilterText(event.currentTarget.value)}
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
                onClick={() => loadDirectory(confirmedListing?.parentPath ?? null)}
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
                onClick={() => loadDirectory(confirmedListing?.homePath ?? null)}
              >
                <Home className="size-4" />
              </Button>

              <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
                <span className="min-w-0 truncate font-mono text-sm text-foreground">
                  {confirmedListing?.currentPath ?? "Loading..."}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {isRefreshing ? (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle className="size-3.5 animate-spin" />
                      Loading...
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
                    Loading directories...
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
                      setFilterText("");
                      loadDirectory(entry.path);
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
            {isSubmitting ? "Confirming..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
