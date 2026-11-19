// The icon of the type of a file, in the color of its type, as the file tree shows it:
// file-type-icon.tsx and file-type-icons.ts in packages/frontend/src/components/ui. The app takes
// the icons of the "complete" icon set of @pierre/trees. The replica copies the icons of the file
// types of the samples. A file type without an icon shows the FileText icon of Lucide.
import { FileText } from "lucide-react";
import type { ReactElement } from "react";
import { classes } from "../classes";
import "./FileTypeIcon.css";

/** The file types of the samples, by the token of the icon resolver of @pierre/trees. */
export type FileType = "typescript" | "react" | "markdown";

/** One path of an icon symbol in its 16 by 16 box. */
export type IconPath = { d: string; opacity?: string; evenOdd?: true };

/** The paths of the icon of each file type, from the symbols of the icon sheet. */
export const FILE_TYPE_ICONS = {
  typescript: [
    { d: "M8 1C2.24 1 1 2.24 1 8s1.24 7 7 7 7-1.24 7-7-1.24-7-7-7", opacity: ".2" },
    {
      d: "M8.1 9.64h.95c.04.62.28.76 1.28.76s1.2-.14 1.2-.85c0-.66-.2-.85-1.2-1.07-1.79-.38-2.18-.7-2.18-1.86C8.15 5.3 8.54 5 10.31 5c1.67 0 2.04.26 2.07 1.42h-.95c-.02-.43-.23-.53-1.1-.53-1 0-1.22.14-1.22.74 0 .52.22.7 1.24.92 1.76.38 2.15.73 2.15 2 0 1.44-.4 1.75-2.24 1.75-1.8 0-2.18-.3-2.15-1.66m-3 1.57V5.99H3.5v-.9h4.21v.9H6.1v5.22z",
    },
  ],
  react: [
    { d: "M8 6.65c.73 0 1.31.6 1.31 1.35S8.73 9.35 8 9.35 6.69 8.75 6.69 8 7.27 6.65 8 6.65" },
    {
      d: "M8 2.55c1.3-.99 2.59-1.34 3.5-.8.92.55 1.27 1.87 1.08 3.53C14.06 5.94 15 6.9 15 8s-.94 2.06-2.42 2.72c.19 1.65-.16 2.98-1.08 3.52-.91.55-2.2.2-3.5-.8-1.3 1-2.58 1.35-3.5.8-.91-.54-1.27-1.87-1.08-3.52C1.94 10.06 1 9.1 1 8s.94-2.06 2.42-2.72c-.19-1.66.17-2.98 1.08-3.52s2.2-.2 3.5.8M4.26 11.2c-.08 1.34.28 2.03.68 2.26s1.15.22 2.25-.52l.11-.09a12 12 0 0 1-1.24-1.39 11 11 0 0 1-1.8-.41zm7.47-.15q-.83.27-1.79.41-.6.8-1.24 1.4l.11.08c1.1.74 1.86.76 2.25.52.4-.23.76-.92.68-2.26zm-3.04.54a14 14 0 0 1-1.38 0q.34.38.69.7.35-.32.7-.7M8 5.29q-.76 0-1.47.1A13 13 0 0 0 5.07 8a14 14 0 0 0 1.46 2.62 13 13 0 0 0 2.94 0A13 13 0 0 0 10.93 8a14 14 0 0 0-1.46-2.62A13 13 0 0 0 8 5.3M4.64 9.18q-.15.5-.25.96.44.16.94.27a15 15 0 0 1-.7-1.23m6.73 0a15 15 0 0 1-.7 1.23q.5-.11.95-.27a10 10 0 0 0-.25-.96M3.44 6.26C2.27 6.86 1.87 7.53 1.87 8s.4 1.14 1.57 1.74l.13.07q.18-.88.55-1.81a12 12 0 0 1-.55-1.8q-.07.02-.13.06m8.99-.07A12 12 0 0 1 11.88 8q.36.94.55 1.8l.13-.06c1.17-.6 1.56-1.27 1.56-1.74s-.39-1.14-1.56-1.74zm-7.1-.6q-.5.11-.94.27.1.46.25.96a15 15 0 0 1 .69-1.23m5.34 0a15 15 0 0 1 .7 1.23q.14-.5.24-.96-.44-.15-.94-.27M7.18 3.06c-1.09-.74-1.85-.76-2.24-.52s-.76.92-.69 2.26l.01.15a11 11 0 0 1 1.8-.41q.6-.8 1.24-1.4zm3.88-.52c-.4-.24-1.15-.22-2.25.52l-.12.08q.65.6 1.25 1.4.96.15 1.8.41v-.14c.08-1.35-.28-2.04-.68-2.27M8 3.7a10 10 0 0 0-.7.7 14 14 0 0 1 1.4 0 10 10 0 0 0-.7-.7",
      evenOdd: true,
    },
  ],
  markdown: [{ d: "M1 12V4h2l2 2.5L7 4h2v8H7V7.5l-2 2-2-2V12zm9-3 3 3.5L16 9h-2V4h-2v5z" }],
} as const satisfies Record<FileType, readonly IconPath[]>;

/**
 * The color of the icon of each file type, as file-type-icons.ts copies it from the styles of the
 * file tree. The theme of the replica sets its color scheme, so light-dark picks the color.
 */
export const FILE_TYPE_COLORS = {
  typescript: "light-dark(#1a85d4, #69b1ff)",
  react: "light-dark(#1ca1c7, #68cdf2)",
  markdown: "light-dark(#199f43, #5ecc71)",
} as const satisfies Record<FileType, string>;

/**
 * The type of the file at `path`, as the icon resolver of the file tree reads it from the file
 * name, for the files of the samples. Null for a file type without an icon of the replica.
 */
export function fileTypeOf(path: string): FileType | null {
  if (path.endsWith(".tsx")) return "react";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".md")) return "markdown";
  return null;
}

/** The icon of the file at `path`: the icon of its type, or the FileText icon of Lucide. */
export function FileTypeIcon({
  path,
  className,
}: {
  path: string;
  className?: string;
}): ReactElement {
  const type = fileTypeOf(path);
  if (!type) return <FileText className={classes("i14 ft-icon", className)} />;
  const paths: readonly IconPath[] = FILE_TYPE_ICONS[type];
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={classes("ft-icon", className)}
      style={{ color: FILE_TYPE_COLORS[type] }}
    >
      {paths.map((path) => (
        <path
          key={path.d}
          fill="currentColor"
          d={path.d}
          opacity={path.opacity}
          fillRule={path.evenOdd ? "evenodd" : undefined}
          clipRule={path.evenOdd ? "evenodd" : undefined}
        />
      ))}
    </svg>
  );
}
