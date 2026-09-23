import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { createContext } from "react";
import type { IssueImageContext } from "@/components/features/issue-source/github-issue-image";

export const TaskDescriptionImageContext = createContext<{
  previews: ReadonlyMap<string, string>;
  renderContext: Omit<TaskAssetRenderContext, "assetId"> | null;
  issueImageContext?: IssueImageContext | undefined;
}>({ previews: new Map(), renderContext: null });
