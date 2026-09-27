import { type ComponentProps, type ReactElement, useMemo } from "react";
import type { Components } from "react-markdown";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { GithubIssueImage, type IssueImageContext } from "./github-issue-image";
import { isGithubIssueAttachmentUrl } from "./issue-image-url";

export type { IssueImageContext } from "./github-issue-image";

export function IssueMarkdownRenderer({
  issueImageContext,
  ...props
}: ComponentProps<typeof MarkdownRenderer> & {
  issueImageContext?: IssueImageContext;
}): ReactElement | null {
  const components = useIssueImageComponents(issueImageContext);
  return <MarkdownRenderer {...props} {...(components ? { components } : {})} />;
}

export function useIssueImageComponents(
  issueImageContext?: IssueImageContext,
): Components | undefined {
  const providerId = issueImageContext?.providerId;
  const repoPath = issueImageContext?.repoPath;
  const sourceId = issueImageContext?.sourceId;
  const taskId = issueImageContext?.taskId;
  return useMemo<Components | undefined>(() => {
    if (!providerId || !repoPath || !sourceId) return undefined;
    const context = { providerId, repoPath, sourceId, taskId };
    return {
      img: ({ node: _node, src, alt, title }) => {
        if (providerId === "github" && isGithubIssueAttachmentUrl(src ?? "")) {
          return <GithubIssueImage context={context} src={src ?? ""} alt={alt} title={title} />;
        }
        return <img src={src} alt={alt ?? ""} title={title} />;
      },
    };
  }, [providerId, repoPath, sourceId, taskId]);
}
