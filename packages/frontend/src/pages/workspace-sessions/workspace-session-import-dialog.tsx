import {
  runtimeKindSchema,
  type WorkspaceSessionExternalListInput,
  type RuntimeKind,
  WorkspaceSession,
  WorkspaceSessionExternal,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import { updateWorkspaceSessionQueries } from "@/state/queries/workspace-sessions";
import { workspaceSessionExternalQueryOptions } from "@/state/queries/workspace-session-import";
import { useMountedRef } from "./use-mounted-ref";
import { WorkspaceSessionImportSearch } from "./workspace-session-import-search";
import { WorkspaceSessionImportResults } from "./workspace-session-import-results";

type Props = {
  workspaceId: string;
  onClose: () => void;
  onImported: (session: WorkspaceSession) => void;
};
export function WorkspaceSessionImportDialog(props: Props) {
  const runtime = useRuntimeAvailabilityContext();
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) props.onClose();
      }}
    >
      <DialogContent
        className={`my-0 gap-0 p-0 sm:max-w-3xl ${selectedRuntime ? "h-[min(44rem,calc(100dvh-2rem))]" : ""}`}
        closeButton={
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3"
            aria-label="Close"
            disabled={pending}
            onClick={props.onClose}
          >
            <X className="size-4" />
          </Button>
        }
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-3 pr-14">
          <DialogTitle>Import session</DialogTitle>
          <DialogDescription>
            Continue an existing conversation from this repository or one of its worktrees.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 overflow-hidden px-5 py-3">
          <div className="shrink-0 space-y-2">
            <Label id="session-import-runtime">Runtime</Label>
            <Combobox
              value={selectedRuntime ?? ""}
              onValueChange={(value) => setSelectedRuntime(runtimeKindSchema.parse(value))}
              disabled={pending || runtime.isLoadingRuntimeDefinitions}
              triggerAriaLabelledBy="session-import-runtime"
              placeholder="Choose a runtime"
              searchable={false}
              options={runtime.allRuntimeDefinitions.map((definition) => ({
                value: definition.kind,
                label: definition.label,
                icon: <AgentRuntimeIcon runtimeKind={definition.kind} />,
                description: runtime.availableRuntimeDefinitions.some(
                  (available) => available.kind === definition.kind,
                )
                  ? ""
                  : "Install and enable this runtime in Settings if unavailable.",
              }))}
            />
          </div>
          {runtime.runtimeDefinitionsError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(runtime.runtimeDefinitionsError)}
            </p>
          )}
          {selectedRuntime && (
            <RuntimeSessionResults
              key={selectedRuntime}
              {...props}
              runtimeKind={selectedRuntime}
              setPending={setPending}
            />
          )}
        </DialogBody>
        <DialogFooter className="mt-0 border-t border-border px-5 py-3">
          <Button variant="outline" disabled={pending} onClick={props.onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuntimeSessionResults({
  workspaceId,
  runtimeKind,
  onClose,
  onImported,
  setPending,
}: Props & { runtimeKind: RuntimeKind; setPending: (pending: boolean) => void }) {
  const [catalogRequestId, setCatalogRequestId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<WorkspaceSessionExternal | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useMountedRef();
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const requestId = crypto.randomUUID();
    setCatalogRequestId(requestId);
    return () => {
      void host
        .workspaceSessionExternalRelease({ workspaceId, catalogRequestId: requestId })
        .catch((error) => {
          setReleaseError(errorMessage(error));
        });
    };
  }, [workspaceId, attempt]);
  const cursor = cursors[page];
  const queryInput: WorkspaceSessionExternalListInput | null = catalogRequestId
    ? {
        workspaceId,
        runtimeKind,
        catalogRequestId,
        search: debouncedSearch,
        pageSize: 50,
      }
    : null;
  if (queryInput && cursor) queryInput.cursor = cursor;
  const result = useQuery({
    ...workspaceSessionExternalQueryOptions(queryInput),
    enabled: search === debouncedSearch,
  });
  const mutation = useMutation({
    mutationFn: (session: WorkspaceSessionExternal) =>
      host.workspaceSessionImport({
        workspaceId,
        runtimeKind,
        externalSessionId: session.externalSessionId,
        workingDirectory: session.workingDirectory,
      }),
    onSuccess: (saved) => {
      updateWorkspaceSessionQueries(queryClient, workspaceId, saved.session);
      if (mounted.current && !saved.openError) {
        onImported(saved.session);
        onClose();
      }
    },
    onSettled: () => {
      submitting.current = false;
      if (mounted.current) setPending(false);
    },
  });
  const pending = mutation.isPending;
  const lookupPending = search !== debouncedSearch || result.isPending || result.isFetching;
  const rows = !lookupPending && !result.isError ? result.data?.sessions : undefined;
  const submit = (session: WorkspaceSessionExternal) => {
    if (submitting.current) return;
    submitting.current = true;
    setSelected(session);
    setPending(true);
    mutation.mutate(session);
  };
  return (
    <>
      <WorkspaceSessionImportSearch
        search={search}
        pending={pending}
        loading={lookupPending}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
          setCursors([undefined]);
        }}
      />
      {result.isError && search === debouncedSearch && (
        <div
          role="alert"
          className="flex max-h-40 shrink-0 flex-col gap-2 overflow-y-auto break-words"
        >
          <p className="text-sm text-destructive">{errorMessage(result.error)}</p>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setPage(0);
              setCursors([undefined]);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {releaseError && (
        <p role="alert" className="text-sm text-destructive">
          {releaseError}
        </p>
      )}
      <WorkspaceSessionImportResults
        rows={rows}
        search={search}
        pending={pending}
        selectedSessionId={selected?.externalSessionId}
        page={page}
        hasNextPage={Boolean(result.data?.nextCursor)}
        onImport={submit}
        onPrevious={() => setPage(page - 1)}
        onNext={() => {
          const next = result.data?.nextCursor;
          if (next) {
            setCursors([...cursors.slice(0, page + 1), next]);
            setPage(page + 1);
          }
        }}
      />
      {mutation.isError && (
        <div
          role="alert"
          className="flex max-h-40 shrink-0 flex-col gap-2 overflow-y-auto break-words"
        >
          <p className="text-sm text-destructive">{errorMessage(mutation.error)}</p>
          {selected && (
            <Button variant="outline" onClick={() => submit(selected)}>
              Retry import
            </Button>
          )}
        </div>
      )}
      {mutation.data?.openError && (
        <div
          role="alert"
          className="flex max-h-40 shrink-0 flex-col gap-2 overflow-y-auto break-words"
        >
          <p className="text-sm text-destructive">{mutation.data.openError}</p>
          <Button
            onClick={() => {
              if (mutation.data) {
                onImported(mutation.data.session);
                onClose();
              }
            }}
          >
            Open saved chat
          </Button>
        </div>
      )}
    </>
  );
}
