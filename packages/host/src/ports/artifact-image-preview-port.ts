import type { ArtifactImagePreview } from "@openducktor/contracts";
import type { Effect } from "effect";

export type ArtifactImagePreviewInput = { mediaType: string; content: Uint8Array };

export type ArtifactImagePreviewPort = {
  previewArtifactImage(input: ArtifactImagePreviewInput): Effect.Effect<ArtifactImagePreview>;
};
