import { z } from "zod";

export const systemOpenInToolIdValues = [
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "vscode",
  "cursor",
  "zed",
  "intellij-idea",
  "webstorm",
  "pycharm",
  "phpstorm",
  "rider",
  "rustrover",
  "android-studio",
] as const;

export const systemOpenInToolIdSchema = z.enum(systemOpenInToolIdValues);
export type SystemOpenInToolId = z.infer<typeof systemOpenInToolIdSchema>;

export const systemOpenInToolInfoSchema = z.object({
  toolId: systemOpenInToolIdSchema,
  iconDataUrl: z.string().min(1).nullable().optional(),
});
export type SystemOpenInToolInfo = z.infer<typeof systemOpenInToolInfoSchema>;

export const systemOpenInToolListSchema = z.array(systemOpenInToolInfoSchema);
export type SystemOpenInToolList = z.infer<typeof systemOpenInToolListSchema>;

export const systemListOpenInToolsRequestSchema = z.object({
  forceRefresh: z.boolean().optional(),
});
export type SystemListOpenInToolsRequest = z.infer<typeof systemListOpenInToolsRequestSchema>;

export const systemOpenDirectoryInToolRequestSchema = z.object({
  directoryPath: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, {
      message: "Directory path is required",
    }),
  toolId: systemOpenInToolIdSchema,
});
export type SystemOpenDirectoryInToolRequest = z.infer<
  typeof systemOpenDirectoryInToolRequestSchema
>;
