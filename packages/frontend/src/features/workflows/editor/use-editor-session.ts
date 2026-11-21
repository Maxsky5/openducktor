import type { WorkflowDocumentView } from "@openducktor/contracts";
import { workflowDocumentQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { workflowPath } from "../workflow-routes";
import { createEditorSession, type EditorSession } from "./editor-session";

/**
 * The editor session of a route. It seeds once from a document read, which a hover on the
 * workflow list can start before the open. A renamed draft-only
 * workflow moves its route, and the open session stays. `reload` seeds a new session after a
 * publication or a discard.
 */
export const useEditorSession = (workflowId: string, routeVersion: number | null) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const client = useHostClient();
  const [session, setSession] = useState<EditorSession | null>(null);
  const matches =
    session !== null && session.routeId === workflowId && session.routeVersion === routeVersion;
  const documentQuery = useQuery({
    ...workflowDocumentQueryOptions(workflowId, routeVersion),
    enabled: !matches,
  });

  const createSession = useCallback(
    (seed: WorkflowDocumentView, sessionVersion: number | null): EditorSession =>
      createEditorSession(seed, sessionVersion, {
        // A draft save sends no library event. The library list reads again on each view.
        saveDraft: (id, document) => client.workflowDraftSave({ workflowId: id, document }),
        onWorkflowIdChange: (savedId) => {
          setSession((current) => (current === null ? current : { ...current, routeId: savedId }));
          navigate(workflowPath(savedId), { replace: true });
        },
      }),
    [client, navigate],
  );

  if (!matches && documentQuery.data?.workflowId === workflowId)
    setSession(createSession(documentQuery.data, routeVersion));

  // A seed is used once. A later open of the workflow reads its document again, since the editor
  // saves changes that the cached read does not have. The key comes from the seeded session, not
  // from the route: a new route reads its own document, and a removal cancels that read.
  const seededId = session?.id;
  const seededRouteId = session?.routeId;
  const seededRouteVersion = session?.routeVersion;
  useEffect(() => {
    if (seededId === undefined || seededRouteId === undefined || seededRouteVersion === undefined)
      return;
    queryClient.removeQueries({
      queryKey: workflowDocumentQueryOptions(seededRouteId, seededRouteVersion).queryKey,
    });
  }, [queryClient, seededId, seededRouteId, seededRouteVersion]);

  const reload = useCallback(async () => {
    if (!session) return;
    const seed = await queryClient.fetchQuery(
      workflowDocumentQueryOptions(session.routeId, session.routeVersion),
    );
    setSession(createSession(seed, session.routeVersion));
  }, [createSession, queryClient, session]);

  return {
    session: matches ? session : null,
    error: documentQuery.isError ? documentQuery.error : null,
    reload,
  };
};
