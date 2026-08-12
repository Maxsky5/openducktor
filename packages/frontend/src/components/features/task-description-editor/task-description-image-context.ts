import type { TaskAssetRenderContext } from "@openducktor/contracts";
import { createContext } from "react";

export const TaskDescriptionImageContext = createContext<{
  previews: ReadonlyMap<string, string>;
  renderContext: Omit<TaskAssetRenderContext, "assetId"> | null;
}>({ previews: new Map(), renderContext: null });
