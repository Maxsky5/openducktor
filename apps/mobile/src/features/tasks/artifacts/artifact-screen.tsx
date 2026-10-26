import type { FreeTaskArtifact } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { taskArtifactsQueryOptions } from "@openducktor/frontend-core/queries/artifacts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useFeedbackStore } from "@/app-shell/app-services";
import { CodeLines, ImagePreview, MarkdownFile } from "@/features/files/file-viewer";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useCommandGate } from "@/host-session/active-session-context";
import { useResourceFiles } from "@/platform/resource-files-context";
import { shareDeviceFile } from "@/rich-content/images/use-image-actions";
import { Button } from "@/ui/button";
import { IconButton } from "@/ui/icon-button";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { type ArtifactFile, artifactFileQueryOptions } from "./artifact-file-query";
import { artifactDetail, artifactIcon } from "./artifact-list-model";

/** One saved file of a task, opened from the Artifacts view or from the chat that saved it. */
export function ArtifactScreen(): ReactElement {
  return (
    <WorkOwnerScreen title="Artifact" diffs={false}>
      {(owner) => <ArtifactContent owner={owner} />}
    </WorkOwnerScreen>
  );
}

function ArtifactContent({ owner }: { owner: WorkOwner }): ReactElement {
  const { code } = useLocalSearchParams<{ code?: string }>();
  if (!owner.task || !code) {
    return (
      <>
        <Stack.Screen options={{ title: "Artifact" }} />
        <EmptyState
          icon="link-off"
          title="Incomplete Link"
          message="It does not name a task artifact. Open the artifact again from its task."
        />
      </>
    );
  }
  return <ArtifactFromLink repoPath={owner.repoPath} taskId={owner.task.id} code={code} />;
}

/** Finds the saved file of the link in the artifact collection, which live changes keep current. */
function ArtifactFromLink({
  repoPath,
  taskId,
  code,
}: {
  repoPath: string;
  taskId: string;
  code: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const gate = useCommandGate();
  const collection = useQuery(taskArtifactsQueryOptions(queryClient, repoPath, taskId));
  const artifact = collection.data?.artifacts.find(
    (item): item is FreeTaskArtifact => item.classification === "free" && item.code === code,
  );
  if (artifact) return <ArtifactView repoPath={repoPath} artifact={artifact} />;
  let body: ReactElement;
  if (collection.data) {
    body = (
      <EmptyState
        icon="file-warning"
        title="Artifact Unavailable"
        message="This task no longer has this artifact. Open Artifacts to select another one."
      />
    );
  } else if (collection.error) {
    body = (
      <ErrorState
        title="Could Not Read the Artifacts"
        message={errorMessage(collection.error)}
        onRetry={gate.open ? () => void collection.refetch() : undefined}
      />
    );
  } else {
    body = <LoadingState label="Loading artifact" />;
  }
  return (
    <>
      <Stack.Screen options={{ title: "Artifact" }} />
      {body}
    </>
  );
}

function ArtifactView({
  repoPath,
  artifact,
}: {
  repoPath: string;
  artifact: FreeTaskArtifact;
}): ReactElement {
  const queryClient = useQueryClient();
  const files = useResourceFiles();
  const gate = useCommandGate();
  const read = useQuery(artifactFileQueryOptions(queryClient, files, repoPath, artifact));
  // A failed read shows its error instead of an earlier version, as the desktop preview does.
  const file = read.error ? null : (read.data ?? null);
  const { sharing, share } = useShareArtifact(artifact);
  const options = useMemo(
    () => ({
      title: artifact.name,
      headerRight: () => (
        <IconButton
          icon="share"
          disabled={file === null || sharing}
          accessibilityLabel={`Share ${artifact.name}`}
          onPress={() => file && share(file.uri)}
        />
      ),
    }),
    [artifact.name, file, share, sharing],
  );
  let body: ReactElement;
  if (read.error) {
    body = (
      <ErrorState
        title="Could Not Read the Artifact"
        message={errorMessage(read.error)}
        onRetry={gate.open ? () => void read.refetch() : undefined}
      />
    );
  } else if (file) {
    body = <ArtifactPreview file={file} onShare={() => share(file.uri)} />;
  } else {
    body = <LoadingState label="Loading artifact" />;
  }
  return (
    <View style={styles.fill}>
      <Stack.Screen options={options} />
      <ArtifactInfo artifact={artifact} />
      {file && file.artifact.revision !== artifact.revision ? (
        <View style={styles.notice}>
          <Callout tone="info" title="Updating preview" />
        </View>
      ) : null}
      {body}
    </View>
  );
}

/** The file name and its format, size, and age, as the desktop preview footer. */
function ArtifactInfo({ artifact }: { artifact: FreeTaskArtifact }): ReactElement {
  const now = useMinuteClock();
  return (
    <View style={styles.info}>
      <Text variant="footnote" weight="medium" numberOfLines={1} ellipsizeMode="middle" selectable>
        {artifact.fileName}
      </Text>
      <Text variant="footnote" tone="tertiary" numberOfLines={1}>
        {artifactDetail(artifact, now)}
      </Text>
    </View>
  );
}

/** The preview of each desktop format. Other formats offer Share, the phone form of Download. */
function ArtifactPreview({
  file,
  onShare,
}: {
  file: ArtifactFile;
  onShare: () => void;
}): ReactElement {
  const { artifact } = file;
  const path = artifact.classification === "free" ? artifact.fileName : artifact.name;
  const shareButton = (
    <Button label="Share" icon="share" variant="outline" size="sm" onPress={onShare} />
  );
  const { preview } = file;
  switch (preview.kind) {
    case "image":
      return <ImagePreview uri={file.uri} path={artifact.name} />;
    case "none":
      return (
        <EmptyState
          icon={artifactIcon(artifact.mediaType)}
          title="No Preview"
          message={`No preview is available for ${artifact.mediaType}. Share this artifact to open it in another app.`}
          action={shareButton}
        />
      );
    case "invalid-text":
      return (
        <EmptyState
          icon="file-warning"
          title="Cannot Preview the Text"
          message="The stored bytes are not valid UTF-8. Share the original file to inspect it."
          action={shareButton}
        />
      );
    case "markdown":
      return <MarkdownFile path={path} contents={preview.text} />;
    case "text":
      return <CodeLines path={path} contents={preview.text} />;
    case "html":
      return (
        <View style={styles.fill}>
          <View style={styles.notice}>
            <Callout
              tone="info"
              title="HTML shows as source"
              message="A preview needs a browser that blocks all network access, and a phone browser cannot do that. Share the file to open it in another app."
            />
          </View>
          <CodeLines path={path} contents={preview.text} />
        </View>
      );
  }
}

/** Opens the share sheet for the device file, the phone form of the desktop Download. */
const useShareArtifact = (artifact: FreeTaskArtifact) => {
  const { feedback } = useFeedbackStore();
  const [sharing, setSharing] = useState(false);
  const share = useCallback(
    async (uri: string): Promise<void> => {
      setSharing(true);
      try {
        if (!(await shareDeviceFile(uri, artifact.name, artifact.mediaType))) {
          feedback.show("warning", "Sharing is not available on this device.");
        }
      } catch (cause) {
        feedback.show("error", "The artifact was not shared.", {
          description: errorMessage(cause),
        });
      } finally {
        setSharing(false);
      }
    },
    [artifact.mediaType, artifact.name, feedback],
  );
  return { sharing, share };
};

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  info: {
    gap: 2,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.sm,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingVertical: theme.space.sm },
}));
