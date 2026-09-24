import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "skills/workbuddy-image-workflow/SKILL.md"));
const name = Buffer.from("workbuddy-image-workflow/SKILL.md", "utf8");
const checksum = crc32(source);

const local = Buffer.alloc(30);
local.writeUInt32LE(0x04034b50, 0);
local.writeUInt16LE(20, 4);
local.writeUInt32LE(checksum, 14);
local.writeUInt32LE(source.length, 18);
local.writeUInt32LE(source.length, 22);
local.writeUInt16LE(name.length, 26);

const central = Buffer.alloc(46);
central.writeUInt32LE(0x02014b50, 0);
central.writeUInt16LE(20, 4);
central.writeUInt16LE(20, 6);
central.writeUInt32LE(checksum, 16);
central.writeUInt32LE(source.length, 20);
central.writeUInt32LE(source.length, 24);
central.writeUInt16LE(name.length, 28);

const centralOffset = local.length + name.length + source.length;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(1, 8);
end.writeUInt16LE(1, 10);
end.writeUInt32LE(central.length + name.length, 12);
end.writeUInt32LE(centralOffset, 16);

const output = resolve(process.argv[2] || resolve(root, "web/public/downloads/workbuddy-image-workflow.zip"));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([local, name, source, central, name, end]));
