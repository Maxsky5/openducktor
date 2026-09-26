import type { TaskAssetStageResult } from "@openducktor/contracts";
import { ImagePlus } from "lucide-react";
import { type ReactElement, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TaskDescriptionAssetUpload } from "./use-task-description-asset-draft";

export function TaskDescriptionMarkdownSource({
  markdown,
  onChange,
  onUpload,
  onEdit,
  uploads,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  onUpload: (file: File) => Promise<TaskAssetStageResult>;
  onEdit: () => void;
  uploads: TaskDescriptionAssetUpload[];
}): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const insertionOffset = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploading = uploads.some((upload) => upload.status === "uploading");

  const uploadFiles = (files: File[]): void => {
    if (uploading || files.length === 0) return;
    const insertAt = insertionOffset.current;
    void Promise.allSettled(files.map(onUpload)).then((results) => {
      const images = results.flatMap((result, index) => {
        const file = files[index];
        if (result.status === "rejected" || !file) return [];
        const alt = file.name.replace(/\.[^.]+$/, "").replace(/([\\[\]])/g, "\\$1");
        const title = file.name.replace(/([\\"])/g, "\\$1");
        return [`![${alt}](odt-asset:${result.value.assetId} "${title}")`];
      });
      if (images.length === 0) return;
      const currentMarkdown = textareaRef.current?.value ?? markdown;
      const offset = Math.min(insertAt, currentMarkdown.length);
      const before = currentMarkdown.slice(0, offset);
      const after = currentMarkdown.slice(offset);
      const leadingBreak = before && !before.endsWith("\n") ? "\n\n" : "";
      const trailingBreak = after && !after.startsWith("\n") ? "\n\n" : "";
      onChange(`${before}${leadingBreak}${images.join("\n")}${trailingBreak}${after}`);
    });
  };

  return (
    <div className="overflow-hidden rounded-md border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
      <div className="flex items-center border-b border-border bg-muted/30 p-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          disabled={uploading}
          onClick={() => {
            insertionOffset.current = textareaRef.current?.selectionStart ?? markdown.length;
            fileInputRef.current?.click();
          }}
        >
          <ImagePlus className="size-4" /> {uploading ? "Uploading image" : "Insert image"}
        </Button>
        <input
          ref={fileInputRef}
          aria-label="Task description images"
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            uploadFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </div>
      <Textarea
        ref={textareaRef}
        id="task-description"
        rows={12}
        value={markdown}
        placeholder="Problem context, scope, and expected output."
        className="min-h-64 resize-y rounded-none border-0 font-sans text-sm shadow-none focus-visible:ring-0"
        onChange={(event) => {
          onEdit();
          onChange(event.currentTarget.value);
        }}
      />
    </div>
  );
}
