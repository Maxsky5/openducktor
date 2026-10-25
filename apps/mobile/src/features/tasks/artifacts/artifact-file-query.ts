import type { FreeTaskArtifact, TaskArtifact } from "@openducktor/contracts";
import { artifactQueryKeys, readTaskArtifact } from "@openducktor/frontend-core/queries/artifacts";
import {
  artifactPreviewKind,
  decodeArtifactText,
} from "@openducktor/frontend-core/tasks/artifacts/artifact-presentation";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { ResourceFiles } from "@/platform/resource-files";

/** What the view of a saved file shows. A text format carries its text. */
export type ArtifactPreview =
  | { kind: "image" | "none" }
  | { kind: "markdown" | "text" | "html"; text: string }
  /** A text format whose bytes are not valid UTF-8. */
  | { kind: "invalid-text" };

/** A read of a saved file into a device file. The file goes away when its last view closes. */
export type ArtifactFile = {
  artifact: TaskArtifact;
  version: string;
  uri: string;
  preview: ArtifactPreview;
};

/**
 * Reads a saved file chunk by chunk into a device file with its stored file name, so the bytes
 * never enter JavaScript memory and the share sheet shows that name. Only a text format reads its
 * bytes back to show the text. Live artifact changes read the file again.
 */
export const artifactFileQueryOptions = (
  queryClient: QueryClient,
  files: ResourceFiles,
  repoPath: string,
  artifact: FreeTaskArtifact,
) =>
  queryOptions({
    queryKey: artifactQueryKeys.file(repoPath, artifact.taskId, artifact.artifactId),
    queryFn: async (context): Promise<ArtifactFile> => {
      const file = files.createPartFile(artifact.fileName);
      try {
        const read = await readTaskArtifact(
          queryClient,
          { repoPath, taskId: artifact.taskId, artifactId: artifact.artifactId },
          context,
          ({ dataBase64 }) => file.appendBase64(dataBase64),
        );
        const kind = artifactPreviewKind(read.artifact.mediaType);
        if (kind === "image" || kind === "none")
          return { ...read, uri: file.uri, preview: { kind } };
        const text = decodeArtifactText(await files.readBytes(file.uri));
        return {
          ...read,
          uri: file.uri,
          preview: text === null ? { kind: "invalid-text" } : { kind, text },
        };
      } catch (error) {
        files.remove(file.uri);
        throw error;
      }
    },
    // Live artifact changes and host recovery read a changed file again.
    staleTime: Infinity,
    gcTime: 0,
  });
