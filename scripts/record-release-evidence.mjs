#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = resolve(root, "token/release-evidence.json");
const options = parseArguments(process.argv.slice(2));
const required = ["check", "artifact", "approved-by", "reference"];
const missing = required.filter((name) => !options[name]);
if (missing.length > 0) {
  throw new Error(
    `Missing arguments: ${missing.map((name) => `--${name}`).join(", ")}`,
  );
}

const artifactPath = resolve(String(options.artifact));
const artifact = await readFile(artifactPath);
const digest = createHash("sha256").update(artifact).digest("hex");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const record = manifest.records.find(
  (item) => item.id === String(options.check),
);
if (!record) throw new Error(`Unknown release check: ${options.check}`);

record.status = "approved";
record.artifactPath = isAbsolute(String(options.artifact))
  ? artifactPath
  : relative(root, artifactPath).replaceAll("\\", "/");
record.sha256 = digest;
record.approvedBy = String(options["approved-by"]).trim();
record.approvedAt = new Date().toISOString();
record.reference = String(options.reference).trim();
manifest.updatedAt = new Date().toISOString();

await writeFile(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      recorded: record.id,
      sha256: digest,
      approvedBy: record.approvedBy,
      reference: record.reference,
    },
    null,
    2,
  ),
);

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) continue;
    result[key.slice(2)] = values[index + 1];
    index += 1;
  }
  return result;
}
