/**
 * Stateless streamable-HTTP MCP dispatch: one server + transport per HTTP
 * request, scoped to the session the bearer token carried. No MCP session
 * state is kept between requests, which is what lets this run behind a
 * plain Cloud Run service without sticky routing.
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandler } from "express";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { IncomingMessage } from "node:http";
import type { ClientFactoryDeps } from "./context.js";
import { buildMcpServer } from "./server.js";

export function createMcpPostHandler(deps: ClientFactoryDeps): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      // requireSealedToken runs first and 401s anything without a valid
      // token, so req.session is always populated here.
      const session = req.session!;
      const server = buildMcpServer({ session, ...deps });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(
        req as unknown as IncomingMessage & { auth?: AuthInfo },
        res,
        req.body,
      );
    })().catch(next);
  };
}

/** GET/DELETE /mcp are only meaningful for stateful sessions, which this server does not use. */
export const mcpMethodNotAllowed: RequestHandler = (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This MCP server is stateless; use POST." },
    id: null,
  });
};
