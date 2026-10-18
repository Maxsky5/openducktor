/**
 * A file that the user picked on this device. Only the platform reads its bytes. It is not a host
 * path. Staging it on the host returns a host path.
 */
export type DeviceFileReference = {
  readonly name: string;
  /** The media type, or an empty string when the device does not know it. */
  readonly type: string;
  readonly size: number;
};

/** Copies a device file to the host and returns the host path of the copy. */
export type AttachmentStager = (file: DeviceFileReference) => Promise<string>;
