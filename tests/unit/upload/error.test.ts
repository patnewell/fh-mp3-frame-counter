import { describe, expect, it } from "vitest";
import { InvalidMp3Error } from "../../../src/mp3/error.ts";
import { describeUploadError, UploadError } from "../../../src/upload/error.ts";

describe("public upload failures", () => {
  it.each([400, 413, 415, 503] as const)("retains trusted %i failures", (status) => {
    expect(describeUploadError(new UploadError(status, "Safe reason"))).toEqual({
      status,
      message: "Safe reason",
    });
  });
  it("marks capacity and draining failures as retryable", () => {
    expect(describeUploadError(new UploadError(503, "Busy", true))).toEqual({
      status: 503,
      message: "Busy",
      retryAfter: 1,
    });
  });
  it.each(["FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"])(
    "maps %s without exposing dependency details",
    (code) =>
      expect(describeUploadError({ code, message: "private" })).toEqual({
        status: 413,
        message: "The upload exceeds a multipart limit.",
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
  });
  it.each([undefined, null, "private", new Error("/private/path"), { code: "ENOSPC" }])(
    "hides unexpected failure details (case %#)",
    (error) =>
      expect(describeUploadError(error)).toEqual({
        status: 500,
        message: "The upload could not be processed.",
      }),
  );
});
