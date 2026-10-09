/** Reserve turn starts before yielding so a settings hold also waits for queued starts. */
export class SessionTurnAdmission {
  private held = false;
  private blocked = false;
  private tail: Promise<void> = Promise.resolve();

  get isClosed(): boolean {
    return this.held || this.blocked;
  }

  get isHeld(): boolean {
    return this.held;
  }

  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
  }

  async hold(): Promise<() => void> {
    if (this.held) throw new Error("A session settings change is already pending.");
    this.held = true;
    await this.tail;
    return () => {
      this.held = false;
    };
  }

  async run<A>(work: () => Promise<A>): Promise<A> {
    if (this.isClosed) {
      throw new Error("Resolve this session's pending speed setting before starting a turn.");
    }
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const previous = this.tail;
    this.tail = promise;
    try {
      await previous;
      if (this.blocked) throw new Error("Set fast mode explicitly before starting another turn.");
      return await work();
    } finally {
      resolve();
    }
  }
}
