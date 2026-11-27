import type { SessionHtmlPreviewReadResult, WorkspaceRef } from "@openducktor/contracts";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { use } from "react";
import { connectionHost } from "../connection/client-connection";
import { errorMessage } from "../lib/errors";
import { ToolPartSessionContext } from "../sessions/messages/use-tool-part-details";

export const sessionHtmlPreviewQueryKeys = {
  all: ["session-html-preview"] as const,
  workspace: (workspaceId: string) => ["session-html-preview", workspaceId] as const,
  byId: (workspaceId: string, previewId: string) =>
    ["session-html-preview", workspaceId, previewId] as const,
};

/** Reads one immutable host-stored session HTML preview by workspace and preview ID. */
export const sessionHtmlPreviewQueryOptions = (
  scope: WorkspaceRef & { previewId: string },
  queryClient: QueryClient,
) =>
  queryOptions<SessionHtmlPreviewReadResult>({
    queryKey: sessionHtmlPreviewQueryKeys.byId(scope.workspaceId, scope.previewId),
    queryFn: () => connectionHost(queryClient).sessionHtmlPreviewRead(scope),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { skipHostRecovery: true },
  });

export type SessionHtmlPreviewState = {
  preview: SessionHtmlPreviewReadResult | null;
  html: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

const resolveSessionHtmlPreviewScope = (
  previewId: string,
  scopeOverride: WorkspaceRef | null | undefined,
  sessionScope: { workspaceId?: string | null } | null | undefined,
  sessionRepoPath: string | null | undefined,
): (WorkspaceRef & { previewId: string }) | null => {
  const workspaceId = scopeOverride?.workspaceId ?? sessionScope?.workspaceId ?? null;
  const repoPath = scopeOverride?.repoPath ?? sessionRepoPath ?? null;
  if (workspaceId === null || repoPath === null || previewId.length === 0) return null;
  return { workspaceId, repoPath, previewId };
};

const EMPTY_PREVIEW_SCOPE: WorkspaceRef & { previewId: string } = {
  workspaceId: "",
  repoPath: "",
  previewId: "",
};

/**
 * Loads the stored HTML document for one `odt_publish_html` preview from the host.
 * Resolves the workspace scope from `scopeOverride` or the enclosing `ToolPartSessionContext`.
 */
export const useSessionHtmlPreview = (
  previewId: string,
  scopeOverride?: WorkspaceRef | null,
  options?: { enabled?: boolean },
): SessionHtmlPreviewState => {
  const session = use(ToolPartSessionContext);
  const queryClient = useQueryClient();
  const scope = resolveSessionHtmlPreviewScope(
    previewId,
    scopeOverride,
    session?.sessionScope,
    session?.repoPath,
  );
  const shouldFetch = options?.enabled !== false;

  const { data, error, isLoading, refetch } = useQuery({
    ...sessionHtmlPreviewQueryOptions(scope ?? EMPTY_PREVIEW_SCOPE, queryClient),
    enabled: scope !== null && shouldFetch,
  });

  if (scope === null) {
    return {
      preview: null,
      html: null,
      loading: false,
      error: "Cannot load this HTML preview without an active workspace session scope.",
      retry: () => {},
    };
  }

  return {
    preview: data ?? null,
    html: data?.html ?? null,
    loading: shouldFetch && isLoading,
    error: shouldFetch && error ? errorMessage(error) : null,
    retry: () => {
      void refetch();
    },
  };
};
