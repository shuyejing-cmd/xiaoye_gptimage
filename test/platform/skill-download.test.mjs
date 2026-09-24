import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crc32 } from "node:zlib";

test("download builder packages the current WorkBuddy skill without other files", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const directory = await mkdtemp(join(tmpdir(), "workbuddy-skill-download-"));
  try {
    const output = join(directory, "workbuddy-image-workflow.zip");
    const result = spawnSync(process.execPath, ["scripts/build-skill-download.mjs", output], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);

    const archive = await readFile(output);
    const end = archive.length - 22;
    assert.equal(archive.readUInt32LE(end), 0x06054b50);
    assert.equal(archive.readUInt16LE(end + 10), 1);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);

    const nameLength = archive.readUInt16LE(26);
    const extraLength = archive.readUInt16LE(28);
    const name = archive.subarray(30, 30 + nameLength).toString("utf8");
    assert.equal(name, "workbuddy-image-workflow/SKILL.md");
    const size = archive.readUInt32LE(22);
    const payload = archive.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + size);
    const source = await readFile(join(root, "skills/workbuddy-image-workflow/SKILL.md"));
    assert.deepEqual(payload, source);
    assert.equal(archive.readUInt32LE(14), crc32(payload));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
