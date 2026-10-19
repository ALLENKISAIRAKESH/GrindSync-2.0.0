import { describe, it, expect, vi, afterEach } from "vitest";
import { generateExplanation } from "../src/services/openai-service.js";
import { SolutionSubmission } from "@codesync/shared";

const SAMPLE_SUBMISSION: SolutionSubmission = {
  platform: "leetcode",
  problem: {
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "Easy",
    statement: "Given an array of integers nums and an integer target, return indices of the two numbers that add up to target.",
  },
  submission: {
    status: "accepted",
    language: "python3",
    code: "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i",
    submittedAt: new Date().toISOString(),
  },
};

describe("generateExplanation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it("returns null when no API key is provided", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await generateExplanation(SAMPLE_SUBMISSION, "detailed", undefined);
    expect(result).toBeNull();
  });

  it("returns null when OPENAI_API_KEY env var is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await generateExplanation(SAMPLE_SUBMISSION);
    expect(result).toBeNull();
  });

  it("returns null when OpenAI API returns an error (mocked)", async () => {
    // Mock the global fetch to simulate an API error
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API key" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateExplanation(SAMPLE_SUBMISSION, "detailed", "invalid-key");
    expect(result).toBeNull();
  });

  it("returns null when OpenAI response has invalid schema (mocked)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                approach: "Use a hashmap",
                // Missing required fields: intuition, step_by_step, etc.
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateExplanation(SAMPLE_SUBMISSION, "detailed", "test-key");
    expect(result).toBeNull();
  });

  it("returns structured ExplanationOutput on valid response (mocked)", async () => {
    const validExplanation = {
      approach: "Use a hash map for O(1) lookups.",
      intuition: "For each element, check if the complement exists.",
      step_by_step: "1. Initialize empty dict\n2. For each num, check complement\n3. Return indices.",
      why_it_works: "The hash map stores previously seen values.",
      time_complexity: "O(n) — single pass through the array.",
      space_complexity: "O(n) — hash map stores at most n elements.",
      edge_cases: ["nums has exactly two elements", "negative numbers", "duplicate values"],
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(validExplanation) } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateExplanation(SAMPLE_SUBMISSION, "detailed", "test-key");

    expect(result).not.toBeNull();
    expect(result?.approach).toBe("Use a hash map for O(1) lookups.");
    expect(result?.time_complexity).toContain("O(n)");
    expect(Array.isArray(result?.edge_cases)).toBe(true);
    expect(result?.edge_cases.length).toBe(3);
  });

  it("uses OPENAI_API_KEY env var when no explicit key is passed (mocked)", async () => {
    process.env.OPENAI_API_KEY = "env-test-key";

    const validExplanation = {
      approach: "Hash map approach",
      intuition: "Complement lookup",
      step_by_step: "1. Build map\n2. Check each element",
      why_it_works: "Hash map provides O(1) lookups",
      time_complexity: "O(n)",
      space_complexity: "O(n)",
      edge_cases: ["empty array"],
    };

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(validExplanation) } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateExplanation(SAMPLE_SUBMISSION);
    expect(result).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer env-test-key",
        }),
      })
    );
  });
});
