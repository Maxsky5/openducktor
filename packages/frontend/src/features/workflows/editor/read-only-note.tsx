import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { plural } from "@openducktor/frontend-core/lib/plural";
import { workflowVersionsQueryOptions } from "@openducktor/frontend-core/queries/workflow-library";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import type { ReactElement } from "react";
import { useEditorState } from "./editor-context";
import { publishedAtText } from "./published-at";

function NoteChip({ text }: { text: string }): ReactElement {
  return (
    <p
      role="note"
      className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-sidebar px-3 text-xs text-muted-foreground shadow-xs"
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </p>
  );
}

/** The publication date and task count of a version, once the version list has them. */
function VersionNote({ routeVersion }: { routeVersion: number }): ReactElement | null {
  const workflowId = useEditorState((state) => state.workflowId);
  const versions = useQuery(workflowVersionsQueryOptions(workflowId));
  if (versions.isError)
    return (
      <NoteChip text={`The version details could not load. ${errorMessage(versions.error)}`} />
    );
  const version = versions.data?.find((entry) => entry.version === routeVersion);
  if (!version) return null;
  return (
    <NoteChip
      text={`Published ${publishedAtText(version.publishedAt)} · ${
        version.taskCount === 0 ? "No task uses it" : `Used by ${plural(version.taskCount, "task")}`
      }`}
    />
  );
}

/**
 * Why the canvas is read-only, in its toolbar: the built-in workflow, or a published version with
 * its publication date and the count of tasks that use it.
 */
export function ReadOnlyNote({
  builtin,
  routeVersion,
}: {
  builtin: boolean;
  routeVersion: number | null;
}): ReactElement | null {
  if (builtin)
    return <NoteChip text="Built-in workflow. Duplicate it to make a copy that you can change." />;
  if (routeVersion === null) return null;
  return <VersionNote routeVersion={routeVersion} />;
}
