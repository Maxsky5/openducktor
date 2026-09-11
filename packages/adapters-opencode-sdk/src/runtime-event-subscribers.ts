import type { OpencodeEventRecipients } from "./opencode-event-recipients";
import type { EventStreamSubscriber } from "./types";

type SubscriberEntry = { subscriber: EventStreamSubscriber; order: number };

export class RuntimeEventSubscribers {
  private readonly byId = new Map<string, SubscriberEntry>();
  private readonly idsByDirectory = new Map<string, Set<string>>();
  private nextOrder = 0;

  get size(): number {
    return this.byId.size;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  set(id: string, subscriber: EventStreamSubscriber): void {
    const previous = this.byId.get(id);
    if (previous) {
      this.removeDirectoryEntry(id, previous.subscriber.input.workingDirectory);
    }
    this.byId.set(id, { subscriber, order: previous?.order ?? this.nextOrder++ });
    const directory = subscriber.input.workingDirectory.trim();
    let ids = this.idsByDirectory.get(directory);
    if (!ids) {
      ids = new Set();
      this.idsByDirectory.set(directory, ids);
    }
    ids.add(id);
  }

  delete(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    this.removeDirectoryEntry(id, entry.subscriber.input.workingDirectory);
    this.byId.delete(id);
  }

  *values(): IterableIterator<EventStreamSubscriber> {
    for (const { subscriber } of this.byId.values()) yield subscriber;
  }

  forDirectory(directory: string): Iterable<EventStreamSubscriber> {
    return this.ordered(this.idsByDirectory.get(directory.trim()) ?? []);
  }

  forEvent(recipients: OpencodeEventRecipients): Iterable<EventStreamSubscriber> {
    const ids = [...recipients.sessionIds];
    if (recipients.directory !== undefined) {
      ids.push(...(this.idsByDirectory.get(recipients.directory) ?? []));
    }
    return this.ordered(ids);
  }

  private *ordered(ids: Iterable<string>): IterableIterator<EventStreamSubscriber> {
    const orderedIds = [...new Set(ids)].sort(
      (left, right) =>
        (this.byId.get(left)?.order ?? Infinity) - (this.byId.get(right)?.order ?? Infinity),
    );
    for (const id of orderedIds) {
      // A preceding recipient can release or replace the next subscription during delivery.
      const entry = this.byId.get(id);
      if (entry) yield entry.subscriber;
    }
  }

  private removeDirectoryEntry(id: string, directory: string): void {
    const key = directory.trim();
    const ids = this.idsByDirectory.get(key);
    if (!ids) return;
    ids.delete(id);
    if (ids.size === 0) this.idsByDirectory.delete(key);
  }
}
