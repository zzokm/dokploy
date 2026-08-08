import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ZodObject, ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools } from "./tools.js";

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

function toDraft2020_12JsonSchema(
	schema: ZodObject<ZodRawShape>,
): Record<string, unknown> {
	const result = zodToJsonSchema(schema, {
		target: "jsonSchema2019-09",
		strictUnions: true,
	}) as Record<string, unknown>;
	result.$schema = JSON_SCHEMA_2020_12;
	return result;
}

export function createOperatorMcpServer() {
	const server = new McpServer({
		name: "dokploy-operator",
		version: "1.0.0",
	});

	for (const tool of tools) {
		server.tool(
			tool.name,
			tool.description,
			tool.schema.shape,
			tool.annotations ?? {},
			async (input) => tool.handler(input as Record<string, unknown>),
		);
	}

	const toolList = tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: toDraft2020_12JsonSchema(tool.schema),
		annotations: tool.annotations,
	}));

	server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: toolList,
	}));

	return server;
}
