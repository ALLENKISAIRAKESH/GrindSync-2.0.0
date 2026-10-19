import { buildServer } from "./server.js";
import { config } from "./config.js";

async function main() {
  const server = buildServer();

  try {
    const address = await server.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[CodeSync Agent] Server listening at ${address}`);
    console.log(`[CodeSync Agent] Bound strictly to loopback (${config.host})`);
  } catch (err) {
    console.error("[CodeSync Agent] Failed to start server:", err);
    process.exit(1);
  }
}

main();
