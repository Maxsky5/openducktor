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
    <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {icon}
        {title}
      </h4>
      {content ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{content}</p>
      ) : (
        <p className="text-sm text-slate-500">{empty}</p>
      )}
    </section>
  );
}
