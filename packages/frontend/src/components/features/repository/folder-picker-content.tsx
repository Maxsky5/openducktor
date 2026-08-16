import type { DirectoryListing } from "@openducktor/contracts";
import { ChevronUp, File, Folder, GitBranch, Home, LoaderCircle, Search } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FolderPickerController } from "./use-folder-picker-controller";

function FolderPickerDirectoryBrowser({
  confirmedListing,
  filteredEntries,
  filterText,
  selectedFilePath,
  status,
  onFilterTextChange,
  onLoadDirectory,
  onSelectFile,
}: {
  confirmedListing: DirectoryListing | null;
  filteredEntries: DirectoryListing["entries"];
  filterText: string;
  selectedFilePath: string | null;
  status: {
    isBusy: boolean;
    isInitialLoad: boolean;
    isRefreshing: boolean;
  };
  onFilterTextChange: (value: string) => void;
  onLoadDirectory: (path?: string | null) => void;
  onSelectFile: (path: string) => void;
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
              No entries match this view.
            </div>
          ) : null}

          {filteredEntries.map((entry) => (
            <Button
              key={entry.path}
              type="button"
              variant="ghost"
              className={cn(
                "h-9 w-full justify-between gap-3 rounded-md px-3 text-left",
                !entry.isDirectory && selectedFilePath === entry.path && "bg-accent",
              )}
              disabled={isBusy}
              aria-pressed={entry.isDirectory ? undefined : selectedFilePath === entry.path}
              data-selected={entry.isDirectory ? undefined : selectedFilePath === entry.path}
              onClick={() =>
                entry.isDirectory ? onLoadDirectory(entry.path) : onSelectFile(entry.path)
              }
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {entry.isDirectory ? (
                  <Folder className="size-4 shrink-0 text-primary" />
                ) : (
                  <File className="size-4 shrink-0 text-muted-foreground" />
                )}
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

export function FolderPickerContent({
  controller,
}: {
  controller: FolderPickerController;
}): ReactElement {
  const {
    manualPath,
    filterText,
    confirmedListing,
    selectedFilePath,
    filteredEntries,
    activeError,
    helperMessage,
    isInitialLoad,
    isRefreshing,
    isBusy,
    selectionMode,
    loadManualPath,
    loadDirectory,
    changeManualPath,
    changeFilterText,
    selectFile,
  } = controller;

  return (
    <>
      <form className="grid gap-2" action={loadManualPath}>
        <Label htmlFor="folder-picker-manual-path" className="sr-only">
          Open path
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="folder-picker-manual-path"
            value={manualPath}
            placeholder={selectionMode === "file" ? "/path/to/folder" : "/path/to/your/repo"}
            className="font-mono"
            disabled={isBusy}
            onChange={(event) => changeManualPath(event.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isBusy || manualPath.trim().length === 0}
          >
            Load path
          </Button>
        </div>
      </form>

      <FolderPickerDirectoryBrowser
        confirmedListing={confirmedListing}
        filteredEntries={filteredEntries}
        filterText={filterText}
        selectedFilePath={selectedFilePath}
        status={{ isBusy, isInitialLoad, isRefreshing }}
        onFilterTextChange={changeFilterText}
        onLoadDirectory={loadDirectory}
        onSelectFile={selectFile}
      />

      {helperMessage ? (
        <div className="rounded-md border border-warning-border bg-warning-surface px-3 py-2.5 text-sm text-warning-surface-foreground">
          {helperMessage}
        </div>
      ) : null}

      {activeError ? (
        <div
          className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-muted"
          role="alert"
        >
          {activeError}
        </div>
      ) : null}
    </>
  );
}
