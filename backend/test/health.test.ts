import { describe, it, expect, afterAll } from "vitest";
import { buildServer } from "../src/server.js";

describe("Agent Server & Health Endpoint", () => {
  const server = buildServer({ nodeEnv: "test" });

  afterAll(async () => {
    await server.close();
  });

  it("GET /health should return 200 with status ok and version", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe("ok");
    expect(json.version).toBeDefined();
  });

  it("Protected /api/v1/* routes should reject requests without bearer token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it("Protected /api/v1/* routes should reject invalid bearer token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: {
        authorization: "Bearer wrong-token",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });
});
