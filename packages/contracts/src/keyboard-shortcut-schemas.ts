import { z } from "zod";
import { shortcutActionIdSchema } from "./shortcut-actions";
export * from "./shortcut-actions";
export * from "./keyboard-shortcut-keys";

export const shortcutKeySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("logical"), key: z.string().min(1).max(32) }),
  z.strictObject({
    kind: z.literal("number-row"),
    digit: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),
  }),
]);
/** Portable keys: `mod` is Command on macOS and Control elsewhere; `ctrl` is Control everywhere. */
export const shortcutCombinationSchema = z
  .strictObject({
    key: shortcutKeySchema,
    mod: z.boolean(),
    ctrl: z.boolean(),
    alt: z.boolean(),
    shift: z.boolean(),
  })
  .refine((value) => value.mod || value.ctrl || value.alt, "Use Command, Control or Alt.");
/** When an app-wide shortcut runs: also while typing in an editor, terminal or visited page, or not. */
export const SHORTCUT_WHEN_VALUES = ["always", "not-typing"] as const;
export const shortcutWhenSchema = z.enum(SHORTCUT_WHEN_VALUES);
export const shortcutPreferencesSchema = z.strictObject({
  version: z.literal(1),
  overrides: z.partialRecord(shortcutActionIdSchema, shortcutCombinationSchema.nullable()),
  /** Only choices that differ from the command's default. */
  when: z.partialRecord(shortcutActionIdSchema, shortcutWhenSchema).optional(),
});
export type ShortcutWhen = z.infer<typeof shortcutWhenSchema>;
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
/** A device signature from `shortcutSignature`, and the command it runs. */
export const shortcutRouteSchema = z.strictObject({
  signature: z.string().min(1),
  commandId: shortcutActionIdSchema,
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

/**
 * The window rules of Electron main. `claims` are the signatures of every active assignment: main
 * keeps native menu accelerators from taking them and leaves them to the renderer. `guestRoutes`
 * run in focused browser guests, where the renderer does not receive keys.
 */
export const electronShortcutRulesSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  recording: z.boolean(),
  claims: z.array(z.string().min(1)),
  /** The routes of each browser guest, by tab ID. */
  guestRoutes: z.record(z.string(), z.array(shortcutRouteSchema)),
});
export type ElectronShortcutRules = z.infer<typeof electronShortcutRulesSchema>;
export interface ElectronShortcutBridge {
  apply(rules: ElectronShortcutRules): Promise<void>;
  subscribe(
    listener: (message: { sourceTabId: string | null; event: EmbeddedShortcutEvent }) => void,
  ): () => void;
  release(): void;
}
