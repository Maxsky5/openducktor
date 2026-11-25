import { type ComponentProps, type ReactElement, useMemo } from "react";
import type { MarkdownImageProps } from "@/components/ui/markdown-host-image";
import { type MarkdownImages, MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { GithubIssueImage, type IssueImageContext } from "./github-issue-image";
import { isHostLoadedIssueImageUrl } from "@openducktor/frontend-core/tasks/issue-import/issue-image-url";

export type { IssueImageContext } from "./github-issue-image";

export function IssueMarkdownRenderer({
  issueImageContext,
  ...props
}: ComponentProps<typeof MarkdownRenderer> & {
  issueImageContext?: IssueImageContext;
}): ReactElement | null {
  const images = useIssueImages(issueImageContext);
  return <MarkdownRenderer {...props} {...(images ? { images } : {})} />;
}

/** The images of an issue that the host loads, such as private GitHub attachments. */
export function useIssueImages(issueImageContext?: IssueImageContext): MarkdownImages | undefined {
  const workspaceId = issueImageContext?.workspaceId;
  const providerId = issueImageContext?.providerId;
  const repoPath = issueImageContext?.repoPath;
  const sourceId = issueImageContext?.sourceId;
  const taskId = issueImageContext?.taskId;
  return useMemo<MarkdownImages | undefined>(() => {
    if (!workspaceId || !providerId || !repoPath || !sourceId) return undefined;
    const context = { workspaceId, providerId, repoPath, sourceId, taskId };
    return {
      handles: (src) => isHostLoadedIssueImageUrl(providerId, src),
      Image: ({ src, alt, title }: MarkdownImageProps) => (
        <GithubIssueImage context={context} src={src} alt={alt} title={title || undefined} />
      ),
    };
  }, [workspaceId, providerId, repoPath, sourceId, taskId]);
}
