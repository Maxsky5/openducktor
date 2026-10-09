import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { createContext, type ReactElement } from "react";
import type { IssueImageContext } from "@/components/features/issue-source/github-issue-image";

export type MarkdownImageProps = {
  src: string;
  alt: string;
  title: string | undefined;
  className: string;
};

export type MarkdownImageRenderer = (props: MarkdownImageProps) => ReactElement | null;

export const TaskDescriptionImageContext = createContext<{
  previews: ReadonlyMap<string, string>;
  renderContext: Omit<TaskAssetRenderContext, "assetId"> | null;
  issueImageContext?: IssueImageContext | undefined;
  renderImage?: MarkdownImageRenderer | undefined;
}>({ previews: new Map(), renderContext: null });
