import { type TaskArtifactCollection, workflowArtifactId } from "@openducktor/contracts";
import { artifactQueryKeys } from "@openducktor/frontend-core/queries/artifacts";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { documentQueryKeys } from "@openducktor/frontend-core/queries/documents";
import type { TaskDocumentPayload } from "@openducktor/frontend-core/types/task-documents";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { TaskArtifactsView } from "@/components/features/task-artifacts/task-artifacts";
import { TourPanelTabs, TourStudio } from "../feature-tour-app-parts";
import { createTourQueryClient } from "../feature-tour-query-client";
import { noop, SESSIONS, sampleTime, WORKSPACES } from "../feature-tour-samples";
import { type FeatureTourSlide, type TourPart, TourPiece } from "../feature-tour-stage";
import { SPEC_ROWS, TITLES_SPEC } from "../feature-tour-transcripts";

// Slide 4: each role saves an artifact, and the next role starts when you start it.

const PARTS: readonly TourPart[] = [
  {
    title: "Workflow rail",
    text: "The roles of the task, in order. A check marks a finished role. Select a role to open its session.",
    pin: { x: 65, y: 69, side: "left" },
  },
  {
    title: "Role session",
    text: "The agent of the role works here. Answer its questions, or ask it for changes.",
    pin: { x: 8, y: 410, side: "left" },
  },
  {
    title: "Start Planner",
    text: "Select this button when you are ready. Planner reads the spec, then writes the plan.",
    pin: { x: 731, y: -7, side: "top" },
  },
  {
    title: "Artifacts",
    text: "The spec, the plan, and the QA report open here. Select the pencil to edit the spec or the plan.",
    pin: { x: 809, y: 115, side: "bottom", from: 146 },
  },
];

/** The session of the picture: Spec saved its spec, and Planner is the next step. */
const SESSION = SESSIONS.titlesSpec;
const TASK = SESSION.context.task;

const STUDIO = { width: 900, height: 632 } as const;

/** The Specification of the task, open in the real Artifacts panel. */
function TourSpecPanel(): ReactElement {
  const workspace = WORKSPACES.fieldnotes;
  // The panel measures the save time against this clock, which ticks once a minute.
  const now = useMinuteClock();
  const [client] = useState(() => {
    // The panel reads the spec from this cache. The document query sets a stale time of its own,
    // so only the refetch options of the cache keep the seeded spec.
    const queryClient = createTourQueryClient();
    const ref = {
      workspaceId: workspace.workspaceId,
      repoPath: workspace.repoPath,
    };
    // The panel shows the save time relative to now, as the transcript that saved it.
    const savedAt = new Date(sampleTime(5, now)).toISOString();
    queryClient.setQueryData(artifactQueryKeys.collection(ref, TASK.id), {
      canManageFree: true,
      artifacts: [
        {
          artifactId: workflowArtifactId(TASK.id, "spec"),
          taskId: TASK.id,
          name: "Specification",
          revision: 1,
          updatedAt: savedAt,
          classification: "workflow",
          code: "spec",
          mediaType: "text/markdown",
        },
      ],
    } satisfies TaskArtifactCollection);
    queryClient.setQueryData(documentQueryKeys.document(ref, TASK.id, "spec"), {
      markdown: TITLES_SPEC,
      updatedAt: savedAt,
    } satisfies TaskDocumentPayload);
    return queryClient;
  });
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TourPanelTabs selected="document" />
      <div className="flex min-h-0 flex-1 flex-col">
        <QueryClientProvider client={client}>
          <TaskArtifactsView
            workspaceId={workspace.workspaceId}
            repoPath={workspace.repoPath}
            taskId={TASK.id}
            task={TASK}
            selection={{ kind: "workflow", code: "spec" }}
            onSelectionChange={noop}
          />
        </QueryClientProvider>
      </div>
    </div>
  );
}

function HandoffStage(): ReactElement {
  return (
    <TourPiece x={0} y={0} width={STUDIO.width} height={STUDIO.height}>
      <div className="flex h-full flex-col">
        <TourStudio
          session={SESSION}
          actionLabel="Start Planner"
          rows={SPEC_ROWS}
          panel={<TourSpecPanel />}
          panelShare={46}
        />
      </div>
    </TourPiece>
  );
}

export const rolesSlide: FeatureTourSlide = {
  id: "roles",
  title: "You decide when the next role starts",
  text: "Spec, Planner, and QA each save an artifact on the task: the spec, the plan, and the QA report. Read each one, edit the spec or the plan, or ask the agent for changes. Then start the next role.",
  explainer: { width: STUDIO.width, height: STUDIO.height, parts: PARTS, stage: <HandoffStage /> },
};
