import { createApp } from "./app.js";
import { BRAND } from "./brand.js";
import { ConfigError, loadConfig } from "./config.js";
import { SealError } from "./seal.js";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError || error instanceof SealError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  createApp({ config }).listen(config.port, () => {
    process.stdout.write(
      `${BRAND.name} listening on :${config.port} (issuer: ${config.issuer ?? "derived from request"})\n`,
    );
  });
}

main();
