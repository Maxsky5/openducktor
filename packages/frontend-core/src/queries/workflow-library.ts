import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

/**
 * The reads of the workflow library. The `openducktor://workflow-library-changed` event
 * invalidates every key under `workflowLibraryQueryKeys.all`. A draft save sends no event, so the
 * library list and the document reads go stale at once and read again on each view.
 */
export const workflowLibraryQueryKeys = {
  all: ["workflow-library"] as const,
  list: ["workflow-library", "list"] as const,
  document: (workflowId: string, version: number | null) =>
    ["workflow-library", "document", workflowId, version] as const,
  versions: (workflowId: string) => ["workflow-library", "versions", workflowId] as const,
  taskUse: (workflowId: string) => ["workflow-library", "task-use", workflowId] as const,
  taskMoves: (workflowId: string, target: "draft" | "latest") =>
    ["workflow-library", "task-moves", workflowId, target] as const,
  roleImpact: (roleId: string) => ["workflow-library", "role-impact", roleId] as const,
  export: (workflowId: string) => ["workflow-library", "export", workflowId] as const,
};

/** The workflows and roles of the host, with the availability of each workflow and the default. */
export const workflowLibraryQueryOptions = () =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.list,
    queryFn: ({ client }) => connectionHost(client).workflowLibraryList(),
    // Draft problem counts change without an event, so each view reads the list again.
    staleTime: 0,
  });

/** How long a document read before the open stays good for the editor seed. */
const DOCUMENT_PREFETCH_MS = 15_000;

/**
 * The document that an editor opens: the draft, else the latest version, else the built-in
 * workflow; or one version. The editor seeds its state once from a fresh read, so no cached
 * document outlives its view.
 */
export const workflowDocumentQueryOptions = (workflowId: string, version: number | null) =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.document(workflowId, version),
    queryFn: ({ client }) =>
      connectionHost(client).workflowDocumentGet(
        version === null ? { workflowId } : { workflowId, version },
      ),
    // A hover on a workflow reads its document before the click. The editor seeds from that read
    // and drops it, so the next open reads the document again.
    staleTime: DOCUMENT_PREFETCH_MS,
    gcTime: DOCUMENT_PREFETCH_MS,
  });

/** The published versions of a workflow. Task counts change without a library event. */
export const workflowVersionsQueryOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.versions(workflowId),
    queryFn: ({ client }) => connectionHost(client).workflowVersionsList({ workflowId }),
    staleTime: 0,
  });

/** The open and closed tasks that use a workflow. The delete dialog reads them on each open. */
export const workflowTaskUseQueryOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.taskUse(workflowId),
    queryFn: ({ client }) => connectionHost(client).workflowTaskUseGet({ workflowId }),
    staleTime: 0,
    gcTime: 0,
  });

/** The tasks that a publication or a move can take to the new version. Each dialog reads again. */
export const workflowTaskMovesQueryOptions = (workflowId: string, target: "draft" | "latest") =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.taskMoves(workflowId, target),
    queryFn: ({ client }) => connectionHost(client).workflowTaskMovesGet({ workflowId, target }),
    staleTime: 0,
    gcTime: 0,
  });

/** The published workflows and running sessions that a role save affects. Each save reads again. */
export const workflowRoleImpactQueryOptions = (roleId: string) =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.roleImpact(roleId),
    queryFn: ({ client }) => connectionHost(client).workflowRoleImpactGet({ roleId }),
    staleTime: 0,
    gcTime: 0,
  });

/** The YAML file of the latest version of a custom workflow. Each export dialog reads again. */
export const workflowExportQueryOptions = (workflowId: string) =>
  queryOptions({
    queryKey: workflowLibraryQueryKeys.export(workflowId),
    queryFn: ({ client }) => connectionHost(client).workflowExport({ workflowId }),
    staleTime: 0,
    gcTime: 0,
  });
