/** Unsupported or malformed media, distinct from upstream input failures and cancellation. */
export class InvalidMp3Error extends Error {
  override readonly name = "InvalidMp3Error";
}
