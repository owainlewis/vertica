/**
 * Keeps autosaves in order while coalescing bursts into the newest snapshot.
 *
 * The worker is deliberately generic so the concurrency rule can be proved without
 * React or a browser. A failed write leaves the queue dirty, making an explicit exit
 * or a later edit retry the same latest snapshot rather than pretending it was saved.
 */
export class SaveQueue<T, R> {
  private readonly worker: (value: T) => Promise<R>;
  private revision = 0;
  private savedRevision = 0;
  private latest: T | undefined;
  private inFlight: Promise<R | undefined> | null = null;

  constructor(worker: (value: T) => Promise<R>) {
    this.worker = worker;
  }

  enqueue(value: T) {
    this.latest = value;
    this.revision += 1;
  }

  get dirty() {
    return this.savedRevision < this.revision;
  }

  flush(): Promise<R | undefined> {
    if (!this.dirty) return Promise.resolve(undefined);

    if (!this.inFlight) {
      this.inFlight = this.drain().finally(() => {
        this.inFlight = null;
      });
    }

    // If a change lands after the drain's final dirty check but before its cleanup
    // runs, chain one more flush instead of returning a resolved, still-dirty queue.
    return this.inFlight.then((result) => (this.dirty ? this.flush() : result));
  }

  private async drain() {
    let result: R | undefined;

    while (this.dirty) {
      const targetRevision = this.revision;
      const value = this.latest;
      if (value === undefined) break;

      result = await this.worker(value);
      this.savedRevision = targetRevision;
    }

    return result;
  }
}
