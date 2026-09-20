import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function httpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* validated below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("MIHOMO_SUBSCRIPTION_URL must be a plain HTTPS URL");
  }
  return url.href;
}

export function createMihomoConfig({ subscriptionUrl, controllerSecret }) {
  if (String(controllerSecret || "").length < 32) throw new Error("MIHOMO_CONTROLLER_SECRET must contain at least 32 characters");
  return {
    "mixed-port": 7890,
    "allow-lan": true,
    "bind-address": "*",
    mode: "rule",
    "log-level": "info",
    ipv6: false,
    "tcp-concurrent": true,
    "external-controller": "0.0.0.0:9090",
    secret: controllerSecret,
    "proxy-providers": {
      subscription: {
        type: "http",
        url: httpsUrl(subscriptionUrl),
        path: "./providers/subscription.yaml",
        interval: 21600,
        "health-check": {
          enable: true,
          url: "https://www.gstatic.com/generate_204",
          interval: 60,
          timeout: 5000,
          lazy: false,
          "expected-status": 204
        }
      }
    },
    "proxy-groups": [{ name: "APIMART", type: "fallback", use: ["subscription"] }],
    rules: ["DOMAIN-SUFFIX,apimart.ai,APIMART", "MATCH,DIRECT"]
  };
}

export async function writeMihomoConfig({ outputPath, subscriptionUrl, controllerSecret }) {
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(createMihomoConfig({ subscriptionUrl, controllerSecret }), null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  await writeMihomoConfig({
    outputPath: process.env.MIHOMO_CONFIG_PATH || "/mihomo/config.yaml",
    subscriptionUrl: process.env.MIHOMO_SUBSCRIPTION_URL,
    controllerSecret: process.env.MIHOMO_CONTROLLER_SECRET
  });
}
