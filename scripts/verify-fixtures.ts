import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import manifest from "../tests/fixtures/manifest.json" with { type: "json" };

// Integrity is independent of the parser, so changing implementation cannot redefine the oracle.
for (const fixture of manifest.fixtures) {
  const bytes = await readFile(new URL(`../tests/fixtures/${fixture.file}`, import.meta.url));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== fixture.bytes || hash !== fixture.sha256) {
    throw new Error(`Fixture identity changed: ${fixture.file}`);
  }
  process.stdout.write(`${fixture.file}: ${bytes.length} bytes; SHA-256 verified\n`);
}
