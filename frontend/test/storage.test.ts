import { describe, it, expect } from "vitest";
import { ExtensionConfigSchema, AgentStatusSchema } from "@codesync/shared";

describe("Extension Storage & Config Schemas", () => {
  it("ExtensionConfigSchema should validate default config values", () => {
    const config = ExtensionConfigSchema.parse({});
    expect(config.agentUrl).toBe("http://127.0.0.1:4578");
    expect(config.bearerToken).toBe("codesync-local-dev-token");
    expect(config.autoSync).toBe(true);
    expect(config.aiExplanation).toBe(true);
    expect(config.explanationStyle).toBe("detailed");
    expect(config.platforms.leetcode).toBe(true);
    expect(config.platforms.gfg).toBe(true);
  });

  it("AgentStatusSchema should validate connected and disconnected states", () => {
    const connected = AgentStatusSchema.parse({
      connected: true,
      version: "0.1.0",
      lastChecked: new Date().toISOString(),
    });
    expect(connected.connected).toBe(true);
    expect(connected.version).toBe("0.1.0");

    const disconnected = AgentStatusSchema.parse({
      connected: false,
      lastChecked: new Date().toISOString(),
      error: "Connection refused",
    });
    expect(disconnected.connected).toBe(false);
    expect(disconnected.error).toBe("Connection refused");
  });
});
