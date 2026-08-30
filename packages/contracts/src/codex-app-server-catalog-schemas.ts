import { z } from "zod";
import { codexInt64Schema } from "./codex-app-server-number-schemas";
import { codexAppServerReasoningEffortSchema } from "./codex-app-server-request-schemas";

const codexAppServerReasoningEffortOptionSchema = z.object({
  description: z.string(),
  reasoningEffort: codexAppServerReasoningEffortSchema,
});

export type CodexAppServerReasoningEffortOption = z.output<
  typeof codexAppServerReasoningEffortOptionSchema
>;

const codexAppServerModelSchema = z.object({
  additionalSpeedTiers: z.array(z.string()),
  availabilityNux: z.object({ message: z.string() }).nullable(),
  defaultReasoningEffort: codexAppServerReasoningEffortSchema,
  defaultServiceTier: z.string().nullable(),
  description: z.string(),
  displayName: z.string(),
  hidden: z.boolean(),
  id: z.string(),
  inputModalities: z.array(z.enum(["text", "image", "audio"])),
  isDefault: z.boolean(),
  model: z.string(),
  modelSpecialty: z.string().nullish(),
  multiAgentVersion: z.enum(["disabled", "v1", "v2"]).nullish(),
  serviceTiers: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  supportedReasoningEfforts: z.array(codexAppServerReasoningEffortOptionSchema),
  supportsPersonality: z.boolean(),
  upgrade: z.string().nullable(),
  upgradeInfo: z
    .object({
      model: z.string(),
      upgradeCopy: z.string().nullable(),
      modelLink: z.string().nullable(),
      migrationMarkdown: z.string().nullable(),
      retirementAt: codexInt64Schema.nullable(),
    })
    .nullable(),
});

export type CodexAppServerModel = z.output<typeof codexAppServerModelSchema>;

export const codexAppServerModelListResponseSchema = z.object({
  data: z.array(codexAppServerModelSchema),
  nextCursor: z.string().nullable(),
});

export type CodexAppServerModelListResponse = z.output<
  typeof codexAppServerModelListResponseSchema
>;

type CodexAppServerSkillInterfaceFields = {
  displayName?: string;
  shortDescription?: string;
  iconSmall?: string;
  iconLarge?: string;
  iconSmallUrl: string | null;
  iconLargeUrl: string | null;
  brandColor?: string;
  defaultPrompt?: string;
};

const codexAppServerSkillInterfaceSchema = z
  .object({
    displayName: z.string().nullish(),
    shortDescription: z.string().nullish(),
    iconSmall: z.string().nullish(),
    iconLarge: z.string().nullish(),
    iconSmallUrl: z.string().nullable(),
    iconLargeUrl: z.string().nullable(),
    brandColor: z.string().nullish(),
    defaultPrompt: z.string().nullish(),
  })
  .transform(
    ({
      displayName,
      shortDescription,
      iconSmall,
      iconLarge,
      iconSmallUrl,
      iconLargeUrl,
      brandColor,
      defaultPrompt,
    }) => {
      const skillInterface: CodexAppServerSkillInterfaceFields = {
        iconSmallUrl,
        iconLargeUrl,
      };

      if (displayName != null) {
        skillInterface.displayName = displayName;
      }
      if (shortDescription != null) {
        skillInterface.shortDescription = shortDescription;
      }
      if (iconSmall != null) {
        skillInterface.iconSmall = iconSmall;
      }
      if (iconLarge != null) {
        skillInterface.iconLarge = iconLarge;
      }
      if (brandColor != null) {
        skillInterface.brandColor = brandColor;
      }
      if (defaultPrompt != null) {
        skillInterface.defaultPrompt = defaultPrompt;
      }

      return skillInterface;
    },
  );

const codexAppServerSkillRecordSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: z.enum(["user", "repo", "system", "admin"]),
  description: z.string(),
  shortDescription: z.string().optional(),
  interface: codexAppServerSkillInterfaceSchema.optional(),
  dependencies: z
    .object({
      tools: z.array(
        z.object({
          type: z.string(),
          value: z.string(),
          description: z.string().optional(),
          transport: z.string().optional(),
          command: z.string().optional(),
          url: z.string().optional(),
        }),
      ),
    })
    .optional(),
  enabled: z.boolean(),
});

export type CodexAppServerSkillRecord = z.output<typeof codexAppServerSkillRecordSchema>;

const codexAppServerSkillCatalogEntrySchema = z.object({
  cwd: z.string(),
  skills: z.array(codexAppServerSkillRecordSchema),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});

export type CodexAppServerSkillCatalogEntry = z.output<
  typeof codexAppServerSkillCatalogEntrySchema
>;

export const codexAppServerSkillsListResponseSchema = z.object({
  data: z.array(codexAppServerSkillCatalogEntrySchema),
});

export type CodexAppServerSkillsListResponse = z.output<
  typeof codexAppServerSkillsListResponseSchema
>;
