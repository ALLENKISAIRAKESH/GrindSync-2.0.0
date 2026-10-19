import {
  SolutionSubmission,
  ExplanationOutput,
  ExplanationOutputSchema,
  ExplanationStyle,
} from "@codesync/shared";

/**
 * Generates a structured AI explanation for a submitted coding solution.
 * Returns null (graceful degradation) if:
 *  - OPENAI_API_KEY is not configured
 *  - OpenAI request fails after retries
 *  - Response does not match the expected schema
 */
export async function generateExplanation(
  submission: SolutionSubmission,
  style: ExplanationStyle = "detailed",
  apiKey?: string
): Promise<ExplanationOutput | null> {
  const resolvedKey = apiKey || process.env.OPENAI_API_KEY;

  if (!resolvedKey) {
    return null;
  }

  const prompt = buildPrompt(submission, style);

  const MAX_RETRIES = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callOpenAI(resolvedKey, prompt);
      return result;
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        err?.status === 429 ||
        err?.status === 500 ||
        err?.status === 502 ||
        err?.status === 503 ||
        err?.code === "ECONNRESET" ||
        err?.name === "AbortError";

      if (!isRetryable || attempt === MAX_RETRIES) {
        break;
      }

      // Exponential backoff: 1s, 2s
      const delay = 1000 * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  console.error("[CodeSync Agent] OpenAI explanation failed:", lastError);
  return null;
}

async function callOpenAI(
  apiKey: string,
  prompt: string
): Promise<ExplanationOutput | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 2048,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const err: any = new Error(
        `OpenAI API error ${response.status}: ${JSON.stringify(errBody)}`
      );
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content;

    if (!rawContent) {
      return null;
    }

    const parsed = JSON.parse(rawContent);
    const validated = ExplanationOutputSchema.safeParse(parsed);

    if (!validated.success) {
      console.error(
        "[CodeSync Agent] OpenAI response schema mismatch:",
        validated.error.format()
      );
      return null;
    }

    return validated.data;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPrompt(submission: SolutionSubmission, style: ExplanationStyle): string {
  const { platform, problem, submission: sub } = submission;
  const platformLabel = platform === "leetcode" ? "LeetCode" : "GeeksForGeeks";
  const styleHint =
    style === "short"
      ? "Be concise — 1-2 sentences per section."
      : style === "interview"
      ? "Write as if explaining in a technical interview. Be clear, structured, and highlight trade-offs."
      : "Be thorough and technically precise.";

  const parts: string[] = [
    `Platform: ${platformLabel}`,
    `Problem: ${problem.title}`,
    ...(problem.difficulty ? [`Difficulty: ${problem.difficulty}`] : []),
    `Language: ${sub.language}`,
    `URL: ${problem.url}`,
  ];

  if (problem.statement) {
    parts.push(`\nProblem Statement:\n${problem.statement}`);
  }

  parts.push(`\nSubmitted Code:\n\`\`\`${sub.language}\n${sub.code}\n\`\`\``);

  return `${parts.join("\n")}\n\n${styleHint}`;
}

const SYSTEM_PROMPT = `You are a senior software engineer, DSA educator, and visualization expert.
Analyze the submitted code and return a JSON object explaining the solution in an intuitive, visual, and easy-to-understand way.
Base your explanation ONLY on the submitted code — do not describe an imaginary alternative solution.
Do not modify or reproduce the code in your response.

Return a JSON object with exactly these keys:
{
  "approach": "<1-3 sentences describing the core algorithm or data structure>",
  "intuition": "<Why this approach works at a high level>",
  "analogy": "<A simple, relatable real-world analogy explaining the core idea to beginners>",
  "mermaid_diagram": "<Valid raw Mermaid flowchart or graph code WITHOUT backticks, e.g.: flowchart TD\\n  A[Start] --> B{Condition}\\n  B -- Yes --> C[Action]\\n  B -- No --> D[Done]>",
  "visual_dry_run": "<A clear ASCII diagram/table showing how pointers/variables change step-by-step on a small concrete input example>",
  "step_by_step": "<Numbered walkthrough of the algorithm as implemented in the code>",
  "why_it_works": "<Proof sketch or invariant that makes the solution correct>",
  "time_complexity": "<Big-O time complexity with clear breakdown>",
  "space_complexity": "<Big-O space complexity with clear breakdown>",
  "edge_cases": ["<edge case 1>", "<edge case 2>"]
}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
