import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, unlink } from "node:fs/promises";
import { discoverWorkBuddyConfig, readRememberedConfigPath, rememberConfigPath } from "./config-discovery.mjs";
import {
  deleteRecoveredApiKey,
  exchangeInstallationToken,
  preserveRecoveredApiKey,
  readRecoveredApiKey,
  restrictPrivateFile
} from "./installation-client.mjs";
import { installVerifiedWorkBuddyConfig, removeWorkBuddyConfig, diagnoseWorkBuddyConfig } from "./config-manager.mjs";

const EXIT_CODES = {
  workbuddy_config_ambiguous: 20,
  workbuddy_config_not_found: 21,
  installation_token_file_insecure: 22,
  invalid_installation_token: 23,
  installation_token_expired: 27,
  installation_token_used: 28,
  api_key_invalid: 29,
  invalid_session: 30,
  account_suspended: 31,
  installation_exchange_unavailable: 24,
  installation_exchange_rejected: 24,
  workbuddy_config_self_check_failed: 25,
  workbuddy_config_invalid: 26
};

function parseOptions(values) {
  return Object.fromEntries(values.map((value) => {
    const separator = value.indexOf("=");
    return separator === -1 ? [value, ""] : [value.slice(0, separator), value.slice(separator + 1)];
  }));
}

function defaultConfigPath() {
  return join(homedir(), ".workbuddy", "mcp.json");
}

async function readAndDelete(path) {
  if (!path) return null;
  try { return (await readFile(path, "utf8")).trim(); }
  finally { await unlink(path).catch(() => {}); }
}

async function resolveConfigPath(command, options, installDir) {
  if (command !== "install-token") return options["--config"] || await readRememberedConfigPath(installDir) || defaultConfigPath();
  const result = await discoverWorkBuddyConfig({ explicitPath: options["--config"] });
  return result.configPath;
}

async function run() {
  const [command, ...values] = process.argv.slice(2);
  const options = parseOptions(values);
  const installDir = options["--install-dir"];

  if (command === "install-token") {
    if (!options["--gateway"] || !options["--token-file"] || !installDir) {
      const error = new Error("installation_arguments_invalid");
      error.code = "installation_arguments_invalid";
      throw error;
    }
    let exchanged;
    try {
      const configPath = await resolveConfigPath(command, options, installDir);
      exchanged = await exchangeInstallationToken({ gatewayUrl: options["--gateway"], tokenFile: options["--token-file"] });
      await rememberConfigPath({ installDir, configPath, restrict: restrictPrivateFile });
      await installVerifiedWorkBuddyConfig({
        configPath,
        gatewayUrl: exchanged.gatewayUrl,
        apiKey: exchanged.apiKey,
        allowedRoots: (options["--roots"] || "").split(";").filter(Boolean),
        installDir,
        restrict: restrictPrivateFile,
        afterVerified: () => rememberConfigPath({ installDir, configPath, restrict: restrictPrivateFile })
      });
      await deleteRecoveredApiKey(installDir);
      console.log(JSON.stringify({ status: "installed", config_path: configPath }));
    } catch (error) {
      if (exchanged?.apiKey) await preserveRecoveredApiKey({ installDir, apiKey: exchanged.apiKey });
      throw error;
    } finally {
      await unlink(options["--token-file"]).catch(() => {});
    }
    return;
  }

  const configPath = await resolveConfigPath(command, options, installDir);

  if (command === "install" || command === "repair") {
    const apiKey = await readAndDelete(options["--key-file"])
      || options["--key"]
      || (command === "repair" && installDir ? await readRecoveredApiKey(installDir) : null);
    if (!apiKey) {
      const error = new Error("api_key_required");
      error.code = "api_key_required";
      throw error;
    }
    await installVerifiedWorkBuddyConfig({
      configPath,
      gatewayUrl: options["--gateway"],
      apiKey,
      allowedRoots: (options["--roots"] || "").split(";").filter(Boolean),
      installDir,
      repair: command === "repair",
      restrict: restrictPrivateFile,
      afterVerified: installDir ? () => rememberConfigPath({ installDir, configPath, restrict: restrictPrivateFile }) : undefined
    });
    if (installDir) await deleteRecoveredApiKey(installDir);
    console.log("WorkBuddy xiaoye-image 配置已安装");
    return;
  }

  if (command === "uninstall") {
    await removeWorkBuddyConfig({ configPath });
    await restrictPrivateFile(configPath);
    console.log("已移除 xiaoye-image；其他 MCP 配置保持不变");
    return;
  }

  if (command === "doctor") {
    let gatewayUrl = options["--gateway"];
    let apiKey = options["--key"] || await readAndDelete(options["--key-file"]);
    if (!apiKey || !gatewayUrl) {
      const current = JSON.parse(await readFile(configPath, "utf8"));
      apiKey ||= current.mcpServers?.["xiaoye-image"]?.env?.IMAGE_API_KEY;
      gatewayUrl ||= current.mcpServers?.["xiaoye-image"]?.env?.IMAGE_GATEWAY_URL;
    }
    const result = await diagnoseWorkBuddyConfig({ configPath, gatewayUrl, apiKey });
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const error = new Error("command_invalid");
  error.code = "command_invalid";
  throw error;
}

run().catch((error) => {
  const code = error?.code || "installation_failed";
  const promptForConfigPath = code === "workbuddy_config_ambiguous" || code === "workbuddy_config_not_found";
  console.error(JSON.stringify({ status: promptForConfigPath ? "prompt_for_config_path" : "failed", code }));
  process.exitCode = EXIT_CODES[code] || 1;
});
