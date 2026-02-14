import type { RunEvent } from "@openblueprint/contracts";
import type { ReactElement } from "react";

type Props = {
  events: RunEvent[];
};

export function ActivityFeed({ events }: Props): ReactElement {
  return (
    <section>
      <h3>Builder Activity</h3>
      <div style={{ display: "grid", gap: 8, maxHeight: 280, overflowY: "auto" }}>
        {events.length === 0 ? <p>No live events yet.</p> : null}
        {events.map((event, index) => (
          <article
            key={`${event.type}-${event.timestamp}-${index}`}
            style={{
              border: "1px solid #e2e8f0",
              background: "#ffffff",
              borderRadius: 8,
              padding: 8,
              fontSize: 13,
            }}
          >
            <strong>{event.type}</strong>
            <p style={{ margin: "4px 0" }}>{event.message}</p>
            <small>{new Date(event.timestamp).toLocaleString()}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
