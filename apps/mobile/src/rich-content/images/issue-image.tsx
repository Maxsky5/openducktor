import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { base64ResourceFileQueryOptions } from "@/platform/resource-files";
import { useResourceFiles } from "@/platform/resource-files-context";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { FittedImage } from "./fitted-image";
import { type HostImageFile, ImagePlaceholder } from "./host-image";
import type { TaskImageContext, TaskIssueImageContext } from "./image-source";

/**
 * An image that the source issue of a task attaches, as the desktop `GithubIssueImage`. The host
 * reads it with the repository credentials, and the bytes go to a device cache file. Away from the
 * viewport, the read and its file go away, and a placeholder keeps the image height.
 */
export const IssueImage = memo(function IssueImage({
  url,
  task,
  issue,
  alt,
  visible,
  onPress,
  accessibilityHint,
}: {
  url: string;
  task: TaskImageContext;
  issue: TaskIssueImageContext;
  alt: string;
  visible: boolean;
  onPress: (file: HostImageFile) => void;
  accessibilityHint: string;
}): ReactElement {
  return visible ? (
    <LoadedIssueImage
      url={url}
      taskId={task.taskId}
      issue={issue}
      alt={alt}
      onPress={onPress}
      accessibilityHint={accessibilityHint}
    />
  ) : (
    <ImagePlaceholder alt={alt} loading={false} recyclingKey={url} />
  );
});

function LoadedIssueImage({
  url,
  taskId,
  issue,
  alt,
  onPress,
  accessibilityHint,
}: {
  url: string;
  taskId: string;
  issue: TaskIssueImageContext;
  alt: string;
  onPress: (file: HostImageFile) => void;
  accessibilityHint: string;
}): ReactElement {
  const host = useHostClient();
  const files = useResourceFiles();
  const { repoPath, providerId } = issue;
  const options = useMemo(
    () =>
      base64ResourceFileQueryOptions(
        files,
        ["issue-image", providerId, repoPath, taskId, url],
        async () => {
          const image = await host.issueImageGet({ repoPath, taskId, url });
          return { base64: image.bytesBase64, mediaType: image.mediaType };
        },
      ),
    [files, host, providerId, repoPath, taskId, url],
  );
  const query = useQuery(options);
  const file = query.data;
  const press = useCallback(() => {
    if (file !== undefined) onPress(file);
  }, [file, onPress]);
  if (query.isError) {
    return (
      <Callout
        tone="destructive"
        title="The image could not be loaded."
        message={errorMessage(query.error)}
        action={
          <Button label="Try Again" size="sm" variant="gray" onPress={() => void query.refetch()} />
        }
      />
    );
  }
  if (file === undefined) return <ImagePlaceholder alt={alt} loading recyclingKey={url} />;
  return (
    <FittedImage
      uri={file.uri}
      recyclingKey={url}
      alt={alt}
      cachePolicy="memory"
      onPress={press}
      accessibilityHint={accessibilityHint}
    />
  );
}
