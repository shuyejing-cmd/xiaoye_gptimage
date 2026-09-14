import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { installWorkBuddyConfig, removeWorkBuddyConfig, diagnoseWorkBuddyConfig } from "./config-manager.mjs";

const [command, ...values] = process.argv.slice(2);
const options = Object.fromEntries(values.map((value) => value.split("=", 2)));
const configPath = options["--config"] || join(homedir(), ".workbuddy", "mcp.json");
let apiKey = options["--key-file"] ? (await readFile(options["--key-file"], "utf8")).trim() : options["--key"];
if (options["--key-file"]) await unlink(options["--key-file"]).catch(() => {});

async function restrictToCurrentUser(path) {
  if (process.platform !== "win32") return;
  execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(R,W)`], { stdio: "ignore" });
}

if (command === "install" || command === "repair") {
  const gatewayUrl = options["--gateway"];
  const result = await diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey });
  if (!result.checks.key) throw new Error("个人 Key 验证失败，请重新复制后再试");
  await installWorkBuddyConfig({ configPath, gatewayUrl, apiKey, allowedRoots: (options["--roots"] || "").split(";").filter(Boolean), installDir: options["--install-dir"], repair: command === "repair" });
  await restrictToCurrentUser(configPath);
  console.log("WorkBuddy xiaoye-image 配置已安装");
} else if (command === "uninstall") {
  await removeWorkBuddyConfig({ configPath });
  await restrictToCurrentUser(configPath);
  console.log("已移除 xiaoye-image；其他 MCP 配置保持不变");
} else if (command === "doctor") {
  let gatewayUrl = options["--gateway"];
  if (!apiKey || !gatewayUrl) {
    const current = JSON.parse(await readFile(configPath, "utf8"));
    apiKey ||= current.mcpServers?.["xiaoye-image"]?.env?.IMAGE_API_KEY;
    gatewayUrl ||= current.mcpServers?.["xiaoye-image"]?.env?.IMAGE_GATEWAY_URL;
  }
  const result = await diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey });
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
} else throw new Error("命令必须是 install、repair、doctor 或 uninstall");
