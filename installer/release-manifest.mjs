import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function buildReleaseManifest({ version, sha256, publisher, installerUrl }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) throw new Error("invalid release version");
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ""))) throw new Error("invalid SHA-256 digest");
  if (!String(publisher || "").trim()) throw new Error("publisher is required");
  const url = new URL(installerUrl);
  if (url.protocol !== "https:") throw new Error("installer URL must use HTTPS");
  return {
    version: String(version),
    sha256: String(sha256),
    publisher: String(publisher),
    installer_url: url.href
  };
}

function parseArgs(values) {
  return Object.fromEntries(values.map((value) => {
    const index = value.indexOf("=");
    return [value.slice(0, index), value.slice(index + 1)];
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildReleaseManifest({
    version: args["--version"],
    sha256: args["--sha256"],
    publisher: args["--publisher"],
    installerUrl: args["--installer-url"]
  });
  if (!args["--output"]) throw new Error("output path is required");
  await writeFile(args["--output"], `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
