/** One admitted upload's capacity reservation; its request lifetime owns release. */
export interface UploadPermit {
  /** Release once owned work settles. Repeated calls are harmless. */
  release(): void;
}

/**
 * Application-local capacity with no queue: an upload acquires a permit or is rejected.
 * Acquisition is synchronous so requests in this event loop cannot oversubscribe the limit.
 * Request deadlines and cancellation belong to lifetime.ts, not the admission counter.
 */
export class UploadAdmission {
  readonly #maximum: number;
  readonly #drainWaiters = new Set<() => void>();
  #active = 0;
  #accepting = true;

  constructor(maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError("Upload capacity must be a positive safe integer.");
    }
    this.#maximum = maximum;
  }

  /**
   * Permits still held, including cancelled requests whose work has not settled.
   * Preferred custom metric for a Kubernetes HPA: active uploads per instance.
   * Target below capacity to scale before uploads are rejected.
   */
  get active(): number {
    return this.#active;
  }

  /** Whether admission is open, independently of whether capacity is currently full. */
  get accepting(): boolean {
    return this.#accepting;
  }

  /** Reserve immediately, or return undefined when full or stopped. Never queue a request. */
  tryAcquire(): UploadPermit | undefined {
    if (!this.#accepting || this.#active === this.#maximum) return undefined;
    this.#active++;
    let released = false;
    return {
      release: () => {
        // Multiple completion paths may attempt to release the same reservation.
        if (released) return;
        released = true;
        if (--this.#active === 0) {
          for (const resolve of this.#drainWaiters) resolve();
          this.#drainWaiters.clear();
        }
      },
    };
  }

  /** Permanently close admission; existing permits remain held until their owners release them. */
  stop(): void {
    this.#accepting = false;
  }

  /** Call stop() first to prevent new uploads while waiting for active work to settle. */
  drained(): Promise<void> {
    if (this.#active === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.add(resolve));
  }
}
