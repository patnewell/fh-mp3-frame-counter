export interface UploadPermit {
  release(): void;
}

/** Reserve capacity synchronously so concurrent requests cannot exceed the app's limit. */
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
   * Preferred custom metric for a Kubernetes HPA: active uploads per instance.
   * Target below capacity to scale before uploads are rejected.
   */
  get active(): number {
    return this.#active;
  }

  get accepting(): boolean {
    return this.#accepting;
  }

  tryAcquire(): UploadPermit | undefined {
    if (!this.#accepting || this.#active === this.#maximum) return undefined;
    this.#active++;
    let released = false;
    return {
      release: () => {
        // Completion and disconnect events may release the same permit.
        if (released) return;
        released = true;
        if (--this.#active === 0) {
          for (const resolve of this.#drainWaiters) resolve();
          this.#drainWaiters.clear();
        }
      },
    };
  }

  stop(): void {
    this.#accepting = false;
  }

  /** Call stop() first to prevent new uploads while waiting for active work to settle. */
  drained(): Promise<void> {
    if (this.#active === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.add(resolve));
  }
}
