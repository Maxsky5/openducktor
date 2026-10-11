import { z } from "zod";

const fileReaderTextSchema = z.string();
const isFileReaderText = (value: FileReader["result"]): value is string =>
  fileReaderTextSchema.safeParse(value).success;

/** Encodes off the renderer main thread: the browser builds the data URL asynchronously. */
export const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = reader.result;
      if (!isFileReaderText(result)) {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      // The media type can contain a quoted comma, and base64 never does.
      const comma = result.lastIndexOf(",");
      if (comma < 0) {
        reject(new Error(`Could not encode ${file.name}.`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
