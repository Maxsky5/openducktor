import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

type SpecMarkdownPreviewProps = {
  markdown: string;
};

export function SpecMarkdownPreview({ markdown }: SpecMarkdownPreviewProps) {
  const hasContent = markdown.trim().length > 0;

  return (
    <div className="min-h-[420px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
      {hasContent ? (
        <MarkdownRenderer
          markdown={markdown}
          variant="document"
          premiumCodeBlocks
          fallback={
            <p className="text-xs text-slate-500">
              Rendering markdown preview with syntax highlighting…
            </p>
          }
        />
      ) : (
        <p className="text-sm text-slate-500">Start writing a specification to preview markdown.</p>
      )}
    </div>
  );
}
