import "@openducktor/frontend-core/queries/query-meta";
import { artifactQueryKeys } from "@openducktor/frontend-core/queries/artifacts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";

/** A host resource, such as a task image, written to a device cache file for native views. */
export type ResourceFile = { uri: string; mediaType: string };
type ResourceBytes = { bytes: Uint8Array; headers: Readonly<Record<string, string>> };
export type ResourceRead = (signal: AbortSignal) => Promise<ResourceBytes>;
/** A resource that the host sends as base64 text, such as a generated image. */
export type Base64Resource = { base64: string; mediaType: string };
/** A device file that a read fills in parts, such as a task artifact. */
export type PartFile = { uri: string; appendBase64: (base64: string) => Promise<void> };

const CACHE_ROOT = "openducktor-resources";
const QUERY_ROOT = "mobile-resource-file";

const EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"],
  ["application/pdf", ".pdf"],
]);

/** Removes resource files that an earlier app run left behind. */
export const clearResourceCache = (): void => {
  const root = new Directory(Paths.cache, CACHE_ROOT);
  if (root.exists) root.delete();
};

/**
 * Keeps resource bytes out of JavaScript memory. Each connection has its own folder; a file goes
 * away when its read leaves the query cache, and the folder goes away with the connection.
 */
export const createResourceFiles = (connectionKey: number) => {
  const directory = new Directory(Paths.cache, CACHE_ROOT, String(connectionKey));
  let next = 0;
  const nextFile = (mediaType: string) => {
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    next += 1;
    return new File(directory, `${next}${EXTENSIONS.get(mediaType) ?? ""}`);
  };
  return {
    async write(bytes: Uint8Array, mediaType: string): Promise<ResourceFile> {
      const file = nextFile(mediaType);
      await file.write(bytes);
      return { uri: file.uri, mediaType };
    },
    /** Decodes base64 text natively, so the decoded bytes never enter JavaScript memory. */
    async writeBase64({ base64, mediaType }: Base64Resource): Promise<ResourceFile> {
      const file = nextFile(mediaType);
      await file.write(base64, { encoding: "base64" });
      return { uri: file.uri, mediaType };
    },
    /**
     * Creates an empty file with this name. Each file has its own folder, so the name stays the
     * stored file name, which the share sheet shows.
     */
    createPartFile(fileName: string): PartFile {
      next += 1;
      const folder = new Directory(directory, String(next));
      folder.create({ intermediates: true });
      const file = new File(folder, fileName);
      file.create();
      return {
        uri: file.uri,
        appendBase64: (base64) => file.write(base64, { encoding: "base64", append: true }),
      };
    },
    /** The bytes of a file, for the text of a text artifact. */
    readBytes(uri: string): Promise<Uint8Array> {
      return new File(uri).bytes();
    },
    remove(uri: string): void {
      const file = new File(uri);
      if (file.exists) file.delete();
    },
    dispose(): void {
      if (directory.exists) directory.delete();
    },
  };
};

export type ResourceFiles = ReturnType<typeof createResourceFiles>;

const isFileRead = (queryKey: QueryKey): boolean =>
  queryKey[0] === QUERY_ROOT ||
  (queryKey[0] === artifactQueryKeys.all[0] && queryKey[1] === "file");

/**
 * Deletes the file of a read when the read leaves the query cache, or when a new read of a
 * changed artifact replaces it.
 */
export const watchResourceFileRemoval = (queryClient: QueryClient, files: ResourceFiles) => {
  const uris = new Map<string, string>();
  return queryClient.getQueryCache().subscribe((event) => {
    const { query } = event;
    if (!isFileRead(query.queryKey)) return;
    if (event.type !== "removed" && event.type !== "updated") return;
    const previous = uris.get(query.queryHash);
    const data = event.type === "removed" ? null : query.state.data;
    const uri = data && "uri" in data ? String(data.uri) : null;
    if (uri === previous) return;
    if (previous) files.remove(previous);
    if (uri) uris.set(query.queryHash, uri);
    else uris.delete(query.queryHash);
  });
};

/**
 * Shares one read of a resource that does not change. The file stays for the default inactive
 * cache time after its last view closes, so a row that scrolls back shows it without a new read.
 * Recovery does not refetch it.
 */
export const base64ResourceFileQueryOptions = (
  files: ResourceFiles,
  key: readonly string[],
  read: (signal: AbortSignal) => Promise<Base64Resource>,
) =>
  queryOptions({
    queryKey: [QUERY_ROOT, ...key],
    queryFn: async ({ signal }): Promise<ResourceFile> => files.writeBase64(await read(signal)),
    staleTime: Infinity,
    retry: false,
    meta: { skipHostRecovery: true },
  });

export const resourceFileQueryOptions = (
  files: ResourceFiles,
  key: readonly string[],
  read: ResourceRead,
) =>
  queryOptions({
    queryKey: [QUERY_ROOT, ...key],
    queryFn: async ({ signal }): Promise<ResourceFile> => {
      const resource = await read(signal);
      const mediaType = resource.headers["content-type"];
      if (!mediaType)
        throw new Error("The host sent this resource without a media type. Update the host.");
      return files.write(resource.bytes, mediaType.split(";")[0]?.trim() ?? mediaType);
    },
    staleTime: Infinity,
    retry: false,
    meta: { skipHostRecovery: true },
  });
