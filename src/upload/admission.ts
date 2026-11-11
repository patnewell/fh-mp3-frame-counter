export interface UploadPermit {
  release(): void;
}

/** One event-loop-owned capacity budget; acquiring never crosses an await point. */
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
        // Several transport events can observe completion of the same upload.
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

  /** Stop admission first when the caller needs a stable shutdown barrier. */
  drained(): Promise<void> {
    if (this.#active === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.add(resolve));
  }
}
