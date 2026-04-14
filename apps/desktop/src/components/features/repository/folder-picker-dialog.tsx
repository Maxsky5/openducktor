import type { DirectoryListing } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, FolderOpen, GitBranch, Home, LoaderCircle } from "lucide-react";
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
  onConfirm: (path: string) => Promise<void> | void;
};

export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialPath,
  onConfirm,
}: FolderPickerDialogProps): ReactElement {
  const [requestedPath, setRequestedPath] = useState<string | undefined>(initialPath);
  const [manualPath, setManualPath] = useState(initialPath ?? "");
  const [filterText, setFilterText] = useState("");
  const [confirmedListing, setConfirmedListing] = useState<DirectoryListing | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmedListing(null);
      setSubmitError(null);
      return;
    }

    setRequestedPath(initialPath);
    setManualPath(initialPath ?? "");
    setFilterText("");
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
    setManualPath(directoryQuery.data.currentPath);
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
    if (!confirmedListing) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!confirmedListing?.parentPath || isBusy}
              onClick={() => loadDirectory(confirmedListing?.parentPath ?? null)}
            >
              <ChevronUp className="size-4" />
              Parent
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!confirmedListing?.homePath || isBusy}
              onClick={() => loadDirectory(confirmedListing?.homePath ?? null)}
            >
              <Home className="size-4" />
              Home
            </Button>
            {isRefreshing ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading directory...
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current Folder
            </p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">
              {confirmedListing?.currentPath ?? "Loading..."}
            </p>
          </div>

          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              loadManualPath();
            }}
          >
            <Label htmlFor="folder-picker-manual-path">Open path</Label>
            <div className="flex gap-2">
              <Input
                id="folder-picker-manual-path"
                value={manualPath}
                placeholder="/absolute/path"
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

          <div className="grid gap-2">
            <Label htmlFor="folder-picker-filter">Filter directories</Label>
            <Input
              id="folder-picker-filter"
              value={filterText}
              placeholder="Search this folder"
              disabled={isBusy || !confirmedListing}
              onChange={(event) => setFilterText(event.currentTarget.value)}
            />
          </div>

          {activeError ? (
            <div className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted">
              {activeError}
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Directories</p>
              {confirmedListing ? (
                <p className="text-xs text-muted-foreground">{filteredEntries.length} visible</p>
              ) : null}
            </div>

            <ScrollArea className="h-80 rounded-lg border border-border bg-card">
              <div className="grid gap-2 p-3">
                {isInitialLoad ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading directories...
                  </div>
                ) : null}

                {!isInitialLoad && confirmedListing && filteredEntries.length === 0 ? (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-6 text-sm text-muted-foreground">
                    No directories match this view.
                  </div>
                ) : null}

                {filteredEntries.map((entry) => (
                  <Button
                    key={entry.path}
                    type="button"
                    variant="outline"
                    className="h-auto justify-between gap-3 overflow-hidden px-3 py-2 text-left"
                    disabled={isBusy}
                    onClick={() => loadDirectory(entry.path)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderOpen className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {entry.name}
                      </span>
                    </span>
                    {entry.isGitRepo ? (
                      <Badge variant="success" className="shrink-0 gap-1">
                        <GitBranch className="size-3" />
                        Git repo
                      </Badge>
                    ) : null}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!confirmedListing || isSubmitting}
            onClick={() => void handleConfirm()}
          >
            {isSubmitting ? "Confirming..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
