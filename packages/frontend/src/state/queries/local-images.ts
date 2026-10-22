import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "@openducktor/frontend-core/connection/client-connection";

export const localImageQueryKeys = {
  image: (path: string) => ["local-image", path] as const,
};

/**
 * An image file of the host, such as an agent screenshot that a reply or a browser card shows.
 * The bytes stay only while a view shows them.
 */
export const localImageQueryOptions = (path: string) =>
  queryOptions({
    queryKey: localImageQueryKeys.image(path),
    queryFn: ({ client }) => connectionHost(client).localImageRead({ path }),
    staleTime: Infinity,
    gcTime: 0,
  });

/** The data URL of a read image. */
export const localImageDataUrl = (image: { mediaType: string; bytesBase64: string }): string =>
  `data:${image.mediaType};base64,${image.bytesBase64}`;
