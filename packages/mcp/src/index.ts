#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOperatorMcpServer } from "./server.js";

async function main() {
	const server = createOperatorMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error("dokploy-operator-mcp fatal:", error);
	process.exit(1);
});
