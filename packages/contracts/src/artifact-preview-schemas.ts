import { z } from "zod";

export const artifactPreviewEnvironmentSchema = z.strictObject({
  bootstrapUrl: z.url(),
  scriptedHtml: z.discriminatedUnion("supported", [
    z.strictObject({ supported: z.literal(true) }),
    z.strictObject({ supported: z.literal(false), reason: z.string().min(1) }),
  ]),
});
export type ArtifactPreviewEnvironment = z.infer<typeof artifactPreviewEnvironmentSchema>;
