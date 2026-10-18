import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { remarkTaskListBlockMath } from "./markdown-task-list-math";

/** The Markdown syntax of the views that show math: GFM, math, and display math in task items. */
export const MATH_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath, remarkTaskListBlockMath];
