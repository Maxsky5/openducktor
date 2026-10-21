import mime from "mime-types";

export type FileDialogFilter = { name: string; extensions: string[] };

/**
 * Turns the `accept` rules of a file input into OS file dialog filters. A rule is an extension
 * such as `.png`, a MIME type such as `image/png`, or a MIME group such as `image/*`. When no
 * rule names a known file type, the dialog shows all files.
 */
export const fileDialogFilters = (accept: readonly string[]): FileDialogFilter[] => {
  const extensions = new Set<string>();
  const knownTypes = Object.entries(mime.extensions);
  for (const rule of accept) {
    const value = rule.trim().toLowerCase();
    if (value.startsWith(".")) {
      if (value.length > 1) extensions.add(value.slice(1));
      continue;
    }
    if (value.endsWith("/*")) {
      const group = value.slice(0, -1);
      for (const [type, typeExtensions] of knownTypes) {
        if (type.startsWith(group))
          typeExtensions.forEach((extension) => extensions.add(extension));
      }
      continue;
    }
    for (const extension of mime.extensions[value] ?? []) {
      extensions.add(extension);
    }
  }
  return extensions.size === 0
    ? []
    : [{ name: "Accepted files", extensions: Array.from(extensions).sort() }];
};
