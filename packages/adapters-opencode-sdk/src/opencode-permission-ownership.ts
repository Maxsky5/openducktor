import { OPENCODE_ODT_TOOL_ID_PREFIXES } from "@openducktor/contracts";
import { z } from "zod";
import type { ParsedOpencodeSession } from "./opencode-ingress";
import type { OpenCodeProtocolValue } from "./guards";
import { permissionRulesEqual, type OpencodePermissionRule } from "./workflow-tool-permissions";

export const PERMISSION_METADATA_KEY = "openducktor.permissions";
const nativeRuleSchema = z
  .object({ permission: z.string(), pattern: z.string(), action: z.enum(["allow", "ask", "deny"]) })
  .strict();
const ownershipSchema = z
  .object({
    version: z.literal(1),
    legacyAmbiguous: z.boolean(),
    inheritancePending: z.boolean().optional(),
    spans: z.array(
      z
        .object({
          layer: z.enum(["defaults", "role", "mandatory", "inherited"]),
          context: z.string(),
          start: z.number().int().nonnegative(),
          rules: z.array(nativeRuleSchema).min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type PermissionOwnership = z.infer<typeof ownershipSchema>;
export type OwnedPermissionSpan = PermissionOwnership["spans"][number];

export const readPermissionOwnership = (
  detail: ParsedOpencodeSession,
): PermissionOwnership | null => {
  const value = detail.metadata?.[PERMISSION_METADATA_KEY];
  return value === undefined ? null : checkPermissionOwnership(value, detail.permission ?? []);
};

export const unownedPermissionRules = (
  permission: OpencodePermissionRule[],
  ownership: PermissionOwnership,
): OpencodePermissionRule[] => {
  checkPermissionOwnership(ownership, permission);
  if (ownership.legacyAmbiguous)
    throw ownershipError("This source predates confirmed OpenDucktor rule ownership.");
  const unowned = permission.filter((_, index) => !ownsRule(ownership, index));
  if (hasWorkflowRules(unowned))
    throw ownershipError("Workflow controls outside the ownership record have an unknown origin.");
  return unowned;
};

/** Untagged workflow controls have no reliable boundary between native and app rules. */
export const emptyPermissionOwnership = (
  permission: OpencodePermissionRule[],
): PermissionOwnership => ({
  version: 1,
  legacyAmbiguous: hasWorkflowRules(permission),
  spans: [],
});

export const inheritedPermissionOwnership = (
  parent: ParsedOpencodeSession,
  child: ParsedOpencodeSession,
  ownership: PermissionOwnership,
): PermissionOwnership => {
  const parentRules = parent.permission ?? [];
  checkPermissionOwnership(ownership, parentRules);
  const inheritedRules = parentRules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.action === "deny" || rule.permission === "external_directory");
  if (
    !permissionRulesEqual(
      (child.permission ?? []).slice(0, inheritedRules.length),
      inheritedRules.map(({ rule }) => rule),
    )
  ) {
    throw ownershipError("The child's inherited permissions do not match its confirmed parent.");
  }
  const spans: OwnedPermissionSpan[] = [];
  for (const [start, entry] of inheritedRules.entries()) {
    if (ownsRule(ownership, entry.index)) {
      spans.push({ layer: "inherited", context: parent.id, start, rules: [entry.rule] });
    }
  }
  return { version: 1, legacyAmbiguous: ownership.legacyAmbiguous, spans };
};

export const ownsRule = (ownership: PermissionOwnership, index: number): boolean =>
  ownership.spans.some((span) => index >= span.start && index < span.start + span.rules.length);

/** Trust the native runtime as the metadata writer. These checks prove rule positions and contents, not authorship. */
export const checkPermissionOwnership = (
  value: OpenCodeProtocolValue | PermissionOwnership | undefined,
  permission: OpencodePermissionRule[],
): PermissionOwnership => {
  const parsed = ownershipSchema.safeParse(value);
  if (!parsed.success) throw ownershipError("The ownership metadata is malformed.");
  let end = 0;
  for (const span of parsed.data.spans) {
    const nextEnd = span.start + span.rules.length;
    if (
      span.start < end ||
      nextEnd > permission.length ||
      !permissionRulesEqual(permission.slice(span.start, nextEnd), span.rules)
    ) {
      throw ownershipError(
        "The ownership metadata does not match the ordered session permissions.",
      );
    }
    end = nextEnd;
  }
  return parsed.data;
};

const hasWorkflowRules = (permission: OpencodePermissionRule[]): boolean =>
  permission.some(
    (rule) =>
      rule.permission.startsWith("odt_") ||
      OPENCODE_ODT_TOOL_ID_PREFIXES.some((prefix) => rule.permission.startsWith(prefix)),
  );

export const ownershipError = (reason: string): Error =>
  new Error(
    `${reason} Cannot confirm OpenCode permission ownership. The source remains usable. Start a new session to use current settings and record ownership, or reconnect the selected runtime if its metadata is unavailable.`,
  );
