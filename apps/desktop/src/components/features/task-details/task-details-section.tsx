import type { ReactElement } from "react";

type TaskDetailsSectionProps = {
  icon: ReactElement;
  title: string;
  value?: string;
  empty: string;
};

export function TaskDetailsSection({
  icon,
  title,
  value,
  empty,
}: TaskDetailsSectionProps): ReactElement {
  const content = value?.trim();
  return (
    <section className="space-y-2 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {icon}
        {title}
      </h4>
      {content ? (
        <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm leading-relaxed text-slate-800">
          {content}
        </p>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
          {empty}
        </p>
      )}
    </section>
  );
}
