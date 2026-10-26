import type { DeviceFileReference } from "@openducktor/frontend-core/platform/device-file";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

// Only this module knows the device URI of a picked file. A reference is never a host path.
const pickedUris = new WeakMap<DeviceFileReference, string>();

const registerPickedFile = (file: {
  name: string;
  type: string;
  size: number;
  uri: string;
}): DeviceFileReference => {
  const reference: DeviceFileReference = { name: file.name, type: file.type, size: file.size };
  pickedUris.set(reference, file.uri);
  return reference;
};

/** The device URI of a file that this app picked, or null for an unknown reference. */
export const pickedFileUri = (file: DeviceFileReference): string | null =>
  pickedUris.get(file) ?? null;

/**
 * The size of a picked file on disk. A picker can omit the size, as an Android document provider
 * without a size column does. The attachment limit then still counts the file.
 */
const fileSize = (uri: string): number => new File(uri).size;

const HEIF_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const isHeif = (name: string, type: string) =>
  HEIF_TYPES.has(type.toLowerCase()) || /\.(heic|heif)$/i.test(name);

/**
 * Converts a HEIC or HEIF photo to JPEG, because the host accepts PNG, JPEG, WebP, and GIF images.
 * A normal device photo then attaches without a format error.
 */
const toHostImage = async (file: {
  name: string;
  type: string;
  size: number;
  uri: string;
}): Promise<{ name: string; type: string; size: number; uri: string }> => {
  if (!isHeif(file.name, file.type)) return file;
  const image = await ImageManipulator.manipulate(file.uri).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return {
    name: `${file.name.replace(/\.(heic|heif)$/i, "") || "photo"}.jpg`,
    type: "image/jpeg",
    size: fileSize(saved.uri),
    uri: saved.uri,
  };
};

/** Opens the photo library. The app never uses the camera for attachments. */
export const pickLibraryImages = async ({
  multiple,
}: {
  multiple: boolean;
}): Promise<DeviceFileReference[]> => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: multiple,
    quality: 1,
    // iOS returns JPEG for HEIC photos in compatible mode.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return [];
  const files = await Promise.all(
    result.assets.map((asset) =>
      toHostImage({
        name: asset.fileName ?? asset.uri.split("/").pop() ?? "photo.jpg",
        type: asset.mimeType ?? "",
        size: asset.fileSize ?? fileSize(asset.uri),
        uri: asset.uri,
      }),
    ),
  );
  return files.map(registerPickedFile);
};

/** Opens the system file picker for the given media types. */
export const pickDocuments = async ({
  types,
  multiple,
}: {
  types: string[];
  multiple: boolean;
}): Promise<DeviceFileReference[]> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: types,
    multiple,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  const files = await Promise.all(
    result.assets.map((asset) =>
      toHostImage({
        name: asset.name,
        type: asset.mimeType ?? "",
        size: asset.size ?? fileSize(asset.uri),
        uri: asset.uri,
      }),
    ),
  );
  return files.map(registerPickedFile);
};
