import { rm } from "node:fs/promises";

// Resolve relative to this script so the build never deletes a caller's working directory.
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
