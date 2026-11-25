import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workflowLibraryQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { workflowCatalogQueryOptions } from "@openducktor/frontend-core/queries/workflows";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useEditorSession } from "@/features/workflows/editor/use-editor-session";
import { EditorSkeleton } from "@/features/workflows/editor/editor-skeleton";
import { WorkflowEditor } from "@/features/workflows/editor/workflow-editor";
import { WORKFLOWS_ROUTE } from "@/features/workflows/workflow-routes";

/** A version route segment as a version number, or null when it is not one. */
const parseVersion = (value: string | undefined): number | null | "invalid" => {
  if (value === undefined) return null;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : "invalid";
};

function PageMessage({ children }: { children: ReactElement | string }): ReactElement {
  return (
    <div className="flex h-full flex-col items-start gap-3 p-6">
      <Button asChild size="sm" variant="ghost">
        <Link to={WORKFLOWS_ROUTE}>
          <ArrowLeft className="size-4" />
          Workflows
        </Link>
      </Button>
      {children}
    </div>
  );
}

/** Loads the session of a valid route and the host reads that the editor checks against. */
function OpenWorkflowEditor({
  workflowId,
  routeVersion,
}: {
  workflowId: string;
  routeVersion: number | null;
}): ReactElement {
  const { session, error, reload } = useEditorSession(workflowId, routeVersion);
  const catalogQuery = useQuery(workflowCatalogQueryOptions());
  // The workflow list reads the same library, so the editor finds it cached.
  const libraryQuery = useQuery(workflowLibraryQueryOptions());
  const failure = error ?? catalogQuery.error ?? libraryQuery.error;
  if (!session && failure)
    return (
      <PageMessage>
        <Alert variant="destructive">
          <AlertDescription>The workflow could not open. {errorMessage(failure)}</AlertDescription>
        </Alert>
      </PageMessage>
    );
  if (!session || !catalogQuery.data || !libraryQuery.data) return <EditorSkeleton />;
  return (
    <WorkflowEditor
      key={session.id}
      session={session}
      catalog={catalogQuery.data}
      library={libraryQuery.data}
      onReload={reload}
    />
  );
}

/**
 * `/workflows/:workflowId` opens the draft, else the latest version, else the read-only built-in
 * workflow. `/workflows/:workflowId/versions/:version` opens one version read-only. The editor
 * seeds once from a fresh document read.
 */
export function WorkflowEditorPage(): ReactElement {
  const params = useParams();
  const version = parseVersion(params.version);
  if (version === "invalid")
    return <PageMessage>{`"${params.version}" is not a version number.`}</PageMessage>;
  return <OpenWorkflowEditor workflowId={params.workflowId ?? ""} routeVersion={version} />;
}
