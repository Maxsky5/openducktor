import { parseTaskAssetUri, TASK_ASSET_URI_PREFIX } from "@openducktor/contracts";
import { isGithubIssueAttachmentUrl } from "@openducktor/frontend-core/tasks/issue-import/issue-image-url";

/** The source issue of a task, whose attached images load through the host. */
export type TaskIssueImageContext = { readonly repoPath: string; readonly providerId: string };

/** The task whose description images a Markdown view shows. */
export type TaskImageContext = {
  readonly workspaceId: string;
  readonly taskId: string;
  /** The issue that the task came from, or null for a task without one. */
  readonly issue: TaskIssueImageContext | null;
};

/** Where a Markdown image comes from. Each kind has its own loader, or a reason it does not show. */
export type MarkdownImageSource =
  | { readonly kind: "task_asset"; readonly assetId: string }
  | { readonly kind: "issue_image"; readonly url: string }
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "unsupported"; readonly reason: string };

/**
 * Classifies a Markdown image. With a task from a GitHub issue, an image that the issue attaches
 * loads through the host, as on desktop, because a private repository needs its credentials.
 */
export const classifyImageSource = (
  url: string,
  context: TaskImageContext | null = null,
): MarkdownImageSource => {
  const source = url.trim();
  if (context?.issue?.providerId === "github" && isGithubIssueAttachmentUrl(source)) {
    return { kind: "issue_image", url: source };
  }
  if (source.startsWith(TASK_ASSET_URI_PREFIX)) {
    const assetId = parseTaskAssetUri(source);
    return assetId === null
      ? { kind: "unsupported", reason: "The task image reference is not valid." }
      : { kind: "task_asset", assetId };
  }
  if (/^https?:\/\//i.test(source)) {
    try {
      return { kind: "remote", url: new URL(source).href };
    } catch {
      return { kind: "unsupported", reason: "The image address is not valid." };
    }
  }
  return {
    kind: "unsupported",
    reason: "Only task images and web images show on this device.",
  };
};
