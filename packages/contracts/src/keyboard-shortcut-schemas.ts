import { z } from "zod";
import { shortcutActionIdSchema } from "./shortcut-actions";
export * from "./shortcut-actions";

export const shortcutKeySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("logical"), key: z.string().min(1).max(32) }),
  z.strictObject({
    kind: z.literal("number-row"),
    digit: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),
  }),
]);
export const shortcutCombinationSchema = z
  .strictObject({
    key: shortcutKeySchema,
    ctrl: z.boolean(),
    meta: z.boolean(),
    alt: z.boolean(),
    shift: z.boolean(),
  })
  .refine((value) => value.ctrl || value.meta || value.alt, "Use Control, Command or Alt.");
export const shortcutPreferencesSchema = z.strictObject({
  version: z.literal(1),
  overrides: z.partialRecord(shortcutActionIdSchema, shortcutCombinationSchema.nullable()),
});
export type ShortcutKey = z.infer<typeof shortcutKeySchema>;
export type ShortcutCombination = z.infer<typeof shortcutCombinationSchema>;
export type ShortcutPreferences = z.infer<typeof shortcutPreferencesSchema>;

export const shortcutInputSchema = z.strictObject({
  phase: z.enum(["down", "up"]),
  key: z.string(),
  code: z.string(),
  ctrl: z.boolean(),
  meta: z.boolean(),
  alt: z.boolean(),
  shift: z.boolean(),
  altGraph: z.boolean().optional(),
  composing: z.boolean(),
  repeat: z.boolean(),
});
export type ShortcutInput = z.infer<typeof shortcutInputSchema>;
export const shortcutRouteSchema = z.strictObject({
  commandId: shortcutActionIdSchema,
  combination: shortcutCombinationSchema,
});
export const embeddedShortcutRulesSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  routes: z.array(shortcutRouteSchema),
});
export const embeddedShortcutEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), revision: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal("invoke"),
    revision: z.number().int().nonnegative(),
    commandId: shortcutActionIdSchema,
    input: shortcutInputSchema,
  }),
  z.strictObject({ type: z.literal("key-state"), input: shortcutInputSchema }),
  z.strictObject({ type: z.literal("blur") }),
  z.strictObject({ type: z.literal("focus") }),
]);
export type ShortcutRoute = z.infer<typeof shortcutRouteSchema>;
export type EmbeddedShortcutRules = z.infer<typeof embeddedShortcutRulesSchema>;
export type EmbeddedShortcutEvent = z.infer<typeof embeddedShortcutEventSchema>;

export const electronShortcutRulesSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  recording: z.boolean(),
  suppressMenuFor: z.array(shortcutCombinationSchema),
  reservePanelCloseModW: z.boolean(),
  guestRoutes: z.array(shortcutRouteSchema),
});
export type ElectronShortcutRules = z.infer<typeof electronShortcutRulesSchema>;
export interface ElectronShortcutBridge {
  apply(rules: ElectronShortcutRules): Promise<void>;
  subscribe(
    listener: (message: { sourceTabId: string | null; event: EmbeddedShortcutEvent }) => void,
  ): () => void;
  release(): void;
}
