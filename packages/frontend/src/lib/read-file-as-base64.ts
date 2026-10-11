import { z } from "zod";

const dataUrlSchema = z.string();

/** The browser builds the data URL off the main thread, so large files do not block the renderer. */
export const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const dataUrl = dataUrlSchema.safeParse(reader.result);
      if (!dataUrl.success) {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      // The media type can contain a quoted comma, and base64 never does.
      const comma = dataUrl.data.lastIndexOf(",");
      if (comma < 0) {
        reject(new Error(`Could not encode ${file.name}.`));
        return;
      }
      resolve(dataUrl.data.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
