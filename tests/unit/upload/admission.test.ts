import { describe, expect, it } from "vitest";
import { UploadAdmission } from "../../../src/upload/admission.ts";

describe("app-owned upload admission", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid capacity %s",
    (maximum) => expect(() => new UploadAdmission(maximum)).toThrow(RangeError),
  );

  it("rejects excess work without queuing and accepts work after release", () => {
    const admission = new UploadAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(admission.active).toBe(2);
    expect(admission.tryAcquire()).toBeUndefined();
    first?.release();
    const replacement = admission.tryAcquire();
    expect(replacement).toBeDefined();
    expect(admission.active).toBe(2);
    replacement?.release();
    second?.release();
    expect(admission.active).toBe(0);
  });

  it("does not release another request's permit after repeated completion", () => {
    const admission = new UploadAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();
    first?.release();
    first?.release();
    expect(admission.active).toBe(1);
    second?.release();
    second?.release();
    expect(admission.active).toBe(0);
  });

  it("keeps independent application budgets separate", () => {
    const first = new UploadAdmission(1);
    const second = new UploadAdmission(1);
    const permit = first.tryAcquire();
    expect(first.tryAcquire()).toBeUndefined();
    const independent = second.tryAcquire();
    expect(independent).toBeDefined();
    permit?.release();
    expect(second.active).toBe(1);
    independent?.release();
  });

  it("stops new work and waits for every active upload before releasing all drain waiters", async () => {
    const admission = new UploadAdmission(2);
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();
    admission.stop();
    admission.stop();
    expect(admission.accepting).toBe(false);
    expect(admission.tryAcquire()).toBeUndefined();
    let completed = 0;
    const drains = [admission.drained(), admission.drained()].map((drain) =>
      drain.then(() => completed++),
    );
    first?.release();
    await Promise.resolve();
    expect(completed).toBe(0);
    second?.release();
    await Promise.all(drains);
    expect(completed).toBe(2);
    expect(admission.tryAcquire()).toBeUndefined();
  });

  it("is already drained when no request owns capacity", async () => {
    const admission = new UploadAdmission(1);
    expect(admission.accepting).toBe(true);
    await expect(admission.drained()).resolves.toBeUndefined();
    admission.stop();
    await expect(admission.drained()).resolves.toBeUndefined();
  });
});
