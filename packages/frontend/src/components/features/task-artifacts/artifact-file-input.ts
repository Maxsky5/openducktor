import {
  TASK_ARTIFACT_MAX_FILE_BYTES,
  type FreeArtifactContentInput,
} from "@openducktor/contracts";

const mediaTypes = new Map<string, string>(
  Object.entries({
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  }),
);

export async function artifactFileInput(file: File): Promise<FreeArtifactContentInput> {
  if (file.size > TASK_ARTIFACT_MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" exceeds the 10 MiB limit. Select a smaller file.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return {
    fileName: file.name,
    mediaType: mediaTypes.get(extension) ?? (file.type || "application/octet-stream"),
    dataBase64: btoa(binary),
  };
}
