import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/shared/host";

export type IssueImageContext = {
  repoPath: string;
  sourceId: string;
  providerId: string;
};

type GithubIssueImageProps = {
  context: IssueImageContext;
  src: string;
  alt?: string | undefined;
  title?: string | undefined;
  className?: string;
};

export const isGithubIssueAttachmentUrl = (url: string): boolean =>
  /^https:\/\/[^/]+\/user-attachments\/assets\/[a-f\d-]{36}$/iu.test(url);

export function GithubIssueImage({
  context,
  src,
  alt,
  title,
  className,
}: GithubIssueImageProps): ReactElement {
  const image = useQuery({
    queryKey: ["issue-image", context.providerId, context.repoPath, context.sourceId, src],
    queryFn: () =>
      host.issueImageGet({ repoPath: context.repoPath, sourceId: context.sourceId, url: src }),
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
