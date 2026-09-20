import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMihomoConfig } from "../../ops/mihomo/render-config.mjs";

test("builds a subscription-backed fallback config that only proxies APIMart", () => {
  const config = createMihomoConfig({
    subscriptionUrl: "https://subscription.example/path?token=secret&mode=clash",
    controllerSecret: "controller-secret-with-at-least-32-characters"
  });
  assert.equal(config["mixed-port"], 7890);
  assert.equal(config.tun?.enable, undefined);
  assert.equal(config["external-controller"], "0.0.0.0:9090");
  assert.equal(config.secret, "controller-secret-with-at-least-32-characters");
  assert.equal(config["proxy-providers"].subscription.url, "https://subscription.example/path?token=secret&mode=clash");
  assert.equal(config["proxy-providers"].subscription.interval, 21600);
  assert.equal(config["proxy-providers"].subscription["health-check"].interval, 60);
  assert.deepEqual(config["proxy-groups"][0], {
    name: "APIMART",
    type: "fallback",
    use: ["subscription"]
  });
  assert.deepEqual(config.rules, ["DOMAIN-SUFFIX,apimart.ai,APIMART", "MATCH,DIRECT"]);
});

test("rejects unsafe subscription URLs and short controller secrets", () => {
  assert.throws(() => createMihomoConfig({ subscriptionUrl: "http://subscription.example", controllerSecret: "x".repeat(32) }), /HTTPS/);
  assert.throws(() => createMihomoConfig({ subscriptionUrl: "https://subscription.example", controllerSecret: "short" }), /32/);
});

test("compose keeps proxy traffic internal and management ports loopback-only", async () => {
  const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
  assert.match(compose, /metacubex\/mihomo:v1\.19\.31/);
  assert.match(compose, /127\.0\.0\.1:9080:80/);
  assert.match(compose, /127\.0\.0\.1:9090:9090/);
  assert.doesNotMatch(compose, /["']?7890:7890/);
});
