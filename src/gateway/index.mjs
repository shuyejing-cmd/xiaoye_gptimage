import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { createTaskStore } from "./task-store.mjs";
import { createReferenceStore } from "./cos-reference-store.mjs";
import { createApimartClient } from "./apimart-client.mjs";
import { createGptGeClient } from "./gpt-ge-client.mjs";
import { createGenerationService } from "./generation-service.mjs";

const config = loadConfig();
const imageProvider = config.imageProvider === "gpt_ge"
  ? createGptGeClient(config.gptGe)
  : createApimartClient({ apiKey: config.apiKey, baseUrl: config.apiBaseUrl });
const referenceStore = createReferenceStore(config.cos);
const app = createApp({
  gatewayToken: config.gatewayToken,
  generationService: createGenerationService({ taskStore: createTaskStore(config.sqlitePath), referenceStore, outputStore: referenceStore, imageProvider })
});
await app.listen({ port: config.port, host: "0.0.0.0" });