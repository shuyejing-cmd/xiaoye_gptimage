#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridgeServer } from "./bridge/mcp-server.mjs";
import { createGatewayClient } from "./bridge/gateway-client.mjs";
const roots=(process.env.ALLOWED_IMAGE_ROOTS||"").split(";").filter(Boolean);
const server=createBridgeServer({allowedRoots:roots,gatewayClient:createGatewayClient({baseUrl:process.env.IMAGE_GATEWAY_URL||"http://127.0.0.1:3000",token:process.env.IMAGE_GATEWAY_TOKEN||""})});
await server.connect(new StdioServerTransport());