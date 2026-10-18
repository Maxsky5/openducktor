import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";

export type IssueImageContext = {
  repoPath: string;
  sourceId: string;
  providerId: string;
  taskId?: string | undefined;
};

type GithubIssueImageProps = {
  context: IssueImageContext;
  src: string;
  alt?: string | undefined;
  title?: string | undefined;
  className?: string;
};

export function GithubIssueImage({
  context,
  src,
  alt,
  title,
  className,
}: GithubIssueImageProps): ReactElement {
  const image = useQuery({
    queryKey: [
      "issue-image",
      context.providerId,
      context.repoPath,
      context.taskId ?? context.sourceId,
      src,
    ],
    queryFn: ({ client }) =>
      connectionHost(client).issueImageGet(
        context.taskId
          ? { repoPath: context.repoPath, taskId: context.taskId, url: src }
          : { repoPath: context.repoPath, sourceId: context.sourceId, url: src },
      ),
    staleTime: Infinity,
  });
  if (image.isPending) {
    return <span className="text-sm text-muted-foreground">Loading image…</span>;
  }
  if (image.isError) {
    return (
      <span role="alert" className="text-sm text-destructive">
        Image could not be loaded: {errorMessage(image.error)}
      </span>
    );
  }
  return (
    <img
      alt={alt ?? ""}
      title={title}
      src={`data:${image.data.mediaType};base64,${image.data.bytesBase64}`}
      className={className}
    />
  );
}
