/**
 * Auth-middleware in front of the MCP layer. The bearer token *is* the
 * session: opening it yields the connected children, so there is no lookup,
 * no store, and no way for a token this server did not seal to get through.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Sealer } from "../seal.js";
import type { SealedSession } from "./types.js";

function unauthorized(res: Response, issuer: string, error: string, description: string): void {
  res
    .status(401)
    // Points an MCP client at discovery so it knows how to re-authorize —
    // which, for an expired or KRÉTA-revoked connection, is the fix.
    .set(
      "WWW-Authenticate",
      `Bearer error="${error}", error_description="${description}", ` +
        `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    )
    .json({ error, error_description: description });
}

export function requireSealedToken(sealer: Sealer, issuerOf: (req: Request) => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      unauthorized(res, issuerOf(req), "invalid_request", "Missing bearer token");
      return;
    }

    let session: SealedSession;
    try {
      session = sealer.open<SealedSession>("access", match[1]!);
    } catch {
      unauthorized(res, issuerOf(req), "invalid_token", "Token is unknown, expired, or malformed");
      return;
    }
    if (!Array.isArray(session.children) || session.children.length === 0) {
      unauthorized(res, issuerOf(req), "invalid_token", "Token carries no connected child");
      return;
    }

    req.session = session;
    next();
  };
}
