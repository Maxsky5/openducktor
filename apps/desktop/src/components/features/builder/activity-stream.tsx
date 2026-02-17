import { Badge } from "@/components/ui/badge";
import type { RunEvent } from "@openblueprint/contracts";
import type { ReactElement } from "react";

type ActivityStreamProps = {
  events: RunEvent[];
};

export function ActivityStream({ events }: ActivityStreamProps): ReactElement {
  return (
    <div className="max-h-[360px] space-y-2 overflow-y-auto">
      {events.length === 0 ? <p className="text-sm text-slate-500">No events yet.</p> : null}
      {events.map((event, index) => (
        <article
          key={`${event.type}-${event.timestamp}-${index}`}
          className="rounded-md border border-slate-200 p-3 text-sm"
        >
          <header className="mb-1 flex items-center justify-between gap-2">
            <Badge variant="secondary">{event.type}</Badge>
            <time className="text-xs text-slate-400">
              {new Date(event.timestamp).toLocaleTimeString()}
            </time>
          </header>
          <p className="text-slate-700">{event.message}</p>
        </article>
      ))}
    </div>
  );
}
