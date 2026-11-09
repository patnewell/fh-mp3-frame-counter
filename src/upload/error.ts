import { InvalidMp3Error } from "../mp3/error.ts";

type ClientStatus = 400 | 413 | 415;

/** An expected transport rejection whose message is safe to return to a client. */
export class UploadError extends Error {
  readonly status: ClientStatus;

  constructor(status: ClientStatus, message: string) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

export interface UploadProblem {
  readonly status: ClientStatus | 500;
  readonly message: string;
}

/** Dependency and filesystem exception text must never become a public error. */
export function describeUploadError(error: unknown): UploadProblem {
  if (error instanceof UploadError) return { status: error.status, message: error.message };
  if (error instanceof InvalidMp3Error) {
    return {
      status: 400,
      message: "The file is not a complete supported MPEG-1 Layer III stream.",
    };
  }
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
  if (
    typeof code === "string" &&
    ["FST_REQ_FILE_TOO_LARGE", "FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"].includes(
      code,
    )
  ) {
    return { status: 413, message: "The upload exceeds a file or multipart limit." };
  }
  if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
    return { status: 415, message: "Use multipart/form-data with one file field named file." };
  }
  if (
    code === "FST_PROTO_VIOLATION" ||
    code === "FST_INVALID_JSON_FIELD_ERROR" ||
    code === "FST_MP_PREMATURE_CLOSE" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    (error instanceof Error &&
      /^(Unexpected end of multipart data|Part terminated early due to unexpected end of multipart data)$/.test(
        error.message,
      ))
  ) {
    return { status: 400, message: "The multipart body is incomplete or malformed." };
  }
  return { status: 500, message: "The upload could not be processed." };
}
