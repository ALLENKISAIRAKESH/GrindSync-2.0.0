import { describe, it, expect, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import { SolutionSubmission } from "@codesync/shared";

describe("Agent Submissions API", () => {
  const server = buildServer({ nodeEnv: "test", repoPath: undefined });
  const validToken = "grindsync-local-dev-token";

  afterAll(async () => {
    await server.close();
  });

  const validPayload: SolutionSubmission = {
    platform: "leetcode",
    problem: {
      title: "Two Sum",
      slug: "two-sum",
      url: "https://leetcode.com/problems/two-sum/",
      difficulty: "Easy",
      statement: "Given an array of integers nums and an integer target...",
    },
    submission: {
      status: "accepted",
      language: "python3",
      code: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i\n        return []",
      submittedAt: new Date().toISOString(),
    },
  };

  it("POST /api/v1/submissions accepts valid LeetCode submission", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.jobId).toBeDefined();
    expect(json.status).toBe("queued");
    expect(json.message).toContain("Two Sum");
  });

  it("POST /api/v1/submissions rejects invalid payload with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: {
        platform: "unknown_platform",
      },
    });

    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe("Invalid submission payload");
    expect(json.details).toBeDefined();
  });

  it("POST /api/v1/submissions rejects missing code with 400", async () => {
    const invalidPayload = {
      ...validPayload,
      submission: {
        ...validPayload.submission,
        code: "",
      },
    };

    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: invalidPayload,
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/v1/submissions/bulk rejects invalid payload with 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions/bulk",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: {
        invalid: "structure",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/v1/submissions/bulk returns 400 when no repo configured", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/submissions/bulk",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: {
        submissions: [validPayload],
      },
    });

    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.payload);
    expect(json.error).toContain("Repository path is not configured");
  });

  it("GET /api/v1/submissions/stats returns accurate synced stats and slugs", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/submissions/stats",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(typeof json.totalSynced).toBe("number");
    expect(Array.isArray(json.syncedSlugs)).toBe(true);
  });

  it("GET /api/v1/platforms/gfg-stats handles missing or empty username gracefully", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/platforms/gfg-stats",
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.totalSolved).toBe(0);
  });
});

