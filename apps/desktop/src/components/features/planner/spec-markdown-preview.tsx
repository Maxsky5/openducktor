import { useMemo } from "react";

type SpecMarkdownPreviewProps = {
  markdown: string;
};

export function SpecMarkdownPreview({ markdown }: SpecMarkdownPreviewProps) {
  const lines = useMemo(() => {
    const occurrences = new Map<string, number>();
    return markdown.split("\n").map((line) => {
      const count = (occurrences.get(line) ?? 0) + 1;
      occurrences.set(line, count);
      return { line, key: `${line}::${count}` };
    });
  }, [markdown]);

  return (
    <div className="min-h-[420px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
      {lines.map(({ line, key }) => {
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const [, hashes = "", rawTitle = ""] = headingMatch;
          const level = hashes.length;
          const title = rawTitle.trim();
          return (
            <p
              key={key}
              className={
                level <= 2
                  ? "mt-4 border-b border-slate-200 pb-1 text-base font-semibold text-slate-900 first:mt-0"
                  : "mt-3 text-sm font-semibold text-slate-800"
              }
            >
              {title}
            </p>
          );
        }

        if (line.startsWith(">")) {
          return (
            <p
              key={key}
              className="mt-2 rounded border-l-2 border-sky-300 bg-sky-50 px-3 py-2 text-xs text-slate-600"
            >
              {line.replace(/^>\s?/, "")}
            </p>
          );
        }

        if (/^[-*]\s+/.test(line)) {
          return (
            <p key={key} className="ml-5 list-item list-disc text-sm text-slate-700">
              {line.replace(/^[-*]\s+/, "")}
            </p>
          );
        }

        if (!line.trim()) {
          return <div key={key} className="h-2" />;
        }

        return (
          <p key={key} className="mt-2 text-sm leading-relaxed text-slate-700">
            {line}
          </p>
        );
      })}
    </div>
  );
}
