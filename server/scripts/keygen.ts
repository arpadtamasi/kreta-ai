/** Prints a fresh base64 TOKEN_SEALING_KEY. Rotating it invalidates every issued token. */
import { randomBytes } from "node:crypto";

process.stdout.write(`${randomBytes(32).toString("base64")}\n`);
