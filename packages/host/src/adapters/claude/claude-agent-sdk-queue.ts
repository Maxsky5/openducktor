import { HostResourceError } from "../../effect/host-errors";

type AsyncQueueResult<T> =
  | {
      done: false;
      value: T;
    }
  | {
      done: true;
      value: undefined;
    };

export class AsyncInputQueue<T> implements AsyncIterable<T> {
  private closed = false;
  private readonly values: T[] = [];
  private waiters: Array<(result: AsyncQueueResult<T>) => void> = [];

  push(value: T): void {
    if (this.closed) {
      throw new HostResourceError({
        resource: "claudeAgentSdkInputQueue",
        operation: "push",
        message: "Cannot send input to a closed Claude Agent SDK session.",
      });
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter({ done: true, value: undefined });
    }
    this.waiters = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const value = this.values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.closed) {
        return;
      }
      const result = await new Promise<AsyncQueueResult<T>>((resolveResult) => {
        this.waiters.push(resolveResult);
      });
      if (result.done) {
        return;
      }
      yield result.value;
    }
  }
}
