import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.ts";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { describeUploadError, UploadError } from "../../../src/upload/error.ts";

describe("public upload failures", () => {
  it.each([400, 413, 415] as const)("retains trusted %i failures", (status) => {
    expect(describeUploadError(new UploadError(status, "Safe reason"))).toEqual({
      status,
      message: "Safe reason",
    });
  });
  it.each(["FST_REQ_FILE_TOO_LARGE", "FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"])(
    "maps %s without exposing dependency details",
    (code) =>
      expect(describeUploadError({ code, message: "private" })).toEqual({
        status: 413,
        message: "The upload exceeds a file or multipart limit.",
      }),
  );
  it.each([
    "FST_PROTO_VIOLATION",
    "FST_INVALID_JSON_FIELD_ERROR",
    "FST_MP_PREMATURE_CLOSE",
    "ERR_STREAM_PREMATURE_CLOSE",
  ])("maps malformed input %s", (code) => expect(describeUploadError({ code }).status).toBe(400));
  it.each([
    "Unexpected end of multipart data",
    "Part terminated early due to unexpected end of multipart data",
  ])("recognizes the documented parser failure %s", (message) =>
    expect(describeUploadError(new Error(message)).status).toBe(400),
  );
  it("distinguishes media rejection from unexpected errors", () => {
    expect(describeUploadError(new InvalidMp3Error("private byte detail")).status).toBe(400);
    expect(describeUploadError({ code: "FST_INVALID_MULTIPART_CONTENT_TYPE" }).status).toBe(415);
    for (const error of [
      undefined,
      null,
      "private",
      new Error("/private/path"),
      { code: "ENOSPC" },
    ]) {
      expect(describeUploadError(error)).toEqual({
        status: 500,
        message: "The upload could not be processed.",
      });
    }
  });
});

describe("application options", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maximum %s",
    (maxFileBytes) => {
      expect(() => createApp({ maxFileBytes })).toThrow(RangeError);
    },
  );
  it.each(["relative", "/bad\0path"])("rejects invalid temporary parent %s", (tempDirectory) => {
    expect(() => createApp({ tempDirectory })).toThrow();
  });
});
