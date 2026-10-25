import type { TaskArtifact } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { taskArtifactsQueryOptions } from "@openducktor/frontend-core/queries/artifacts";
import { groupTaskArtifacts } from "@openducktor/frontend-core/tasks/artifacts/artifact-presentation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { type ReactElement, useMemo } from "react";
import { ScrollView } from "react-native";
import { qaVerdictPresentation } from "@/features/tasks/presentation/task-document-paint";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { WorkHeaderTitle } from "@/features/work-owner/work-header-title";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { Badge } from "@/ui/badge";
import { SkeletonFrame } from "@/ui/placeholders";
import { useScreenEndSpace } from "@/ui/screen";
import { EmptyState, ErrorState } from "@/ui/states";
import { ListRow, ListRowPlaceholder, ListSection } from "@/ui/surfaces";
import { artifactDetail, artifactIcon, workflowDocumentKey } from "./artifact-list-model";

/** The Artifacts view of a task: its workflow documents and the files that people and agents saved. */
export function ArtifactsScreen(): ReactElement {
  return (
    <WorkOwnerScreen
      title="Artifacts"
      diffs={false}
      background="grouped"
      skeleton={<ArtifactsSkeleton />}
    >
      {(owner) => <ArtifactsContent owner={owner} />}
    </WorkOwnerScreen>
  );
}

function ArtifactsContent({ owner }: { owner: WorkOwner }): ReactElement {
  const options = useMemo(
    () => ({
      title: "Artifacts",
      headerTitle: () => (
        <WorkHeaderTitle title="Artifacts" subtitle={owner.title} subtitleEllipsis="tail" />
      ),
    }),
    [owner.title],
  );
  return (
    <>
      <Stack.Screen options={options} />
      {owner.task ? (
        <TaskArtifactList owner={owner} taskId={owner.task.id} />
      ) : (
        <EmptyState
          icon="files"
          title="No Artifacts"
          message="Chats have no artifacts. Open Artifacts from a task."
        />
      )}
    </>
  );
}

function TaskArtifactList({ owner, taskId }: { owner: WorkOwner; taskId: string }): ReactElement {
  const queryClient = useQueryClient();
  const gate = useCommandGate();
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const collection = useQuery(taskArtifactsQueryOptions(queryClient, owner.repoPath, taskId));
  const groups = useMemo(
    () => (collection.data ? groupTaskArtifacts(collection.data.artifacts) : null),
    [collection.data],
  );
  if (!groups) {
    return collection.error ? (
      <ErrorState
        title="Could Not Read the Artifacts"
        message={errorMessage(collection.error)}
        onRetry={gate.open ? () => void collection.refetch() : undefined}
      />
    ) : (
      <ArtifactsSkeleton />
    );
  }
  if (groups.workflow.length === 0 && groups.files.length === 0) {
    return (
      <EmptyState
        icon="files"
        title="No Artifacts Yet"
        message="Workflow documents and the files that people and agents save for this task show here."
      />
    );
  }
  const workspaceId = owner.workspace.workspaceId;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // The safe area sets this end padding. It changes only on rotation and moves no row.
      // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
      contentContainerStyle={{ paddingBottom: endSpace }}
    >
      {groups.workflow.length > 0 ? (
        <ListSection title="Workflow" first>
          {groups.workflow.map((artifact) => (
            <ArtifactRow
              key={artifact.artifactId}
              artifact={artifact}
              href={routes.documents(workspaceId, taskId, workflowDocumentKey(artifact.code))}
            />
          ))}
        </ListSection>
      ) : null}
      {groups.files.length > 0 ? (
        <ListSection title="Files" first={groups.workflow.length === 0}>
          {groups.files.map((artifact) => (
            <ArtifactRow
              key={artifact.artifactId}
              artifact={artifact}
              href={routes.artifact(workspaceId, taskId, artifact.code)}
            />
          ))}
        </ListSection>
      ) : null}
    </ScrollView>
  );
}

function ArtifactRow({
  artifact,
  href,
}: {
  artifact: TaskArtifact;
  href: ReturnType<typeof routes.documents> | ReturnType<typeof routes.artifact>;
}): ReactElement {
  const router = useRouter();
  const now = useMinuteClock();
  const detail = artifactDetail(artifact, now);
  const verdict =
    artifact.classification === "workflow" && artifact.verdict
      ? qaVerdictPresentation(artifact.verdict)
      : null;
  return (
    <ListRow
      title={artifact.name}
      subtitle={detail}
      icon={artifactIcon(artifact.mediaType)}
      trailing={verdict ? <Badge label={verdict.label} tone={verdict.tone} /> : undefined}
      accessory="chevron"
      accessibilityLabel={[artifact.name, detail, verdict?.label].filter(Boolean).join(", ")}
      accessibilityHint="Opens the artifact."
      onPress={() => router.push(href)}
    />
  );
}

/** The artifact list for its first load, in the layout of the loaded Workflow section. */
function ArtifactsSkeleton(): ReactElement {
  return (
    <ScrollView scrollEnabled={false} contentInsetAdjustmentBehavior="automatic">
      <SkeletonFrame label="Loading artifacts">
        <ListSection title="Workflow" first>
          <ListRowPlaceholder
            leadingSize={32}
            titleWidth="42%"
            detail={{ variant: "subhead", width: "30%" }}
          />
          <ListRowPlaceholder
            leadingSize={32}
            titleWidth="56%"
            detail={{ variant: "subhead", width: "24%" }}
          />
        </ListSection>
      </SkeletonFrame>
    </ScrollView>
  );
}
