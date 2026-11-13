import { FileText } from "lucide-react";
import { type ReactElement, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import { mountFileTypeIconSprite, resolveFileTypeIcon } from "./file-type-icons";

type FileTypeIconProps = {
  filePath: string;
  className?: string | undefined;
};

/**
 * The icon of a file in the color of its type, as the file tree shows it. A file type without an
 * icon shows the base file icon.
 */
export const FileTypeIcon = ({ filePath, className }: FileTypeIconProps): ReactElement => {
  useLayoutEffect(mountFileTypeIconSprite, []);
  const icon = resolveFileTypeIcon(filePath);
  if (!icon) return <FileText aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn("size-3.5 shrink-0", className)}
      style={icon.color ? { color: icon.color } : undefined}
    >
      <use href={icon.href} />
    </svg>
  );
};
