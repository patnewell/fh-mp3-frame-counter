import { describe, expect, it } from "vitest";
import { countFrames } from "../../../src/mp3/count.ts";
import { frame } from "../../helpers/mp3.ts";

describe("incremental parser acceptance", () => {
  it("counts complete frames from an asynchronous byte source", async () => {
    async function* source() {
      yield frame();
      yield frame();
    }
    expect(await countFrames(source())).toBe(2);
  });
});
