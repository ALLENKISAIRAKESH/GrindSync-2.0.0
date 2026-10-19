import { SolutionSubmission, BulkSubmissionResponse, BulkSubmissionResponseSchema, Difficulty } from "@codesync/shared";
import { getConfig } from "../storage/config.js";

export interface PlatformSyncStats {
  platform: "leetcode" | "gfg";
  totalSolved: number;
  alreadyPushed: number;
  needToPush: number;
  username?: string;
  solvedSlugs: string[];
  syncedSlugs: string[];
}

export interface AgentSyncedStats {
  totalSynced: number;
  byPlatform: Record<string, number>;
  syncedSlugs: string[];
}

/**
 * Safely extracts LeetCode session and CSRF cookies using chrome.cookies.getAll.
 */
export async function getLeetCodeSession(): Promise<{ session?: string; csrf?: string }> {
  if (typeof chrome === "undefined" || !chrome.cookies || !chrome.cookies.getAll) {
    return {};
  }
  return new Promise((resolve) => {
    try {
      chrome.cookies.getAll({ domain: "leetcode.com" }, (cookies) => {
        if (chrome.runtime?.lastError || !cookies) {
          resolve({});
          return;
        }
        const session = cookies.find((c) => c.name === "LEETCODE_SESSION")?.value;
        const csrf = cookies.find((c) => c.name === "csrftoken")?.value;
        resolve({ session, csrf });
      });
    } catch {
      resolve({});
    }
  });
}

/**
 * Queries the local GrindSync agent for current synchronized problem slugs and counts.
 */
export async function fetchSyncedStats(platform?: string): Promise<AgentSyncedStats> {
  try {
    const config = await getConfig();
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (config.repoPath) params.set("repoPath", config.repoPath);
    const query = params.toString() ? `?${params.toString()}` : "";
    const url = `${config.agentUrl.replace(/\/+$/, "")}/api/v1/submissions/stats${query}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
      },
    });

    if (!res.ok) {
      return { totalSynced: 0, byPlatform: {}, syncedSlugs: [] };
    }

    const data = await res.json();
    return {
      totalSynced: data.totalSynced || 0,
      byPlatform: data.byPlatform || {},
      syncedSlugs: data.syncedSlugs || [],
    };
  } catch (err) {
    console.warn("[GrindSync] Failed to query synced stats from agent:", err);
    return { totalSynced: 0, byPlatform: {}, syncedSlugs: [] };
  }
}

/**
 * Fetches solved problem statistics for LeetCode or GeeksForGeeks.
 */
export async function fetchPlatformStats(
  platform: "leetcode" | "gfg",
  username?: string
): Promise<PlatformSyncStats> {
  const agentStats = await fetchSyncedStats(platform);
  const syncedSet = new Set(agentStats.syncedSlugs.map((s) => s.toLowerCase()));

  if (platform === "leetcode") {
    let totalSolved = 0;
    let resolvedUser = username || "";
    const solvedSlugs: string[] = [];

    // 1. Try logged-in session API with cookies
    try {
      const { session, csrf } = await getLeetCodeSession();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (session) {
        headers["Cookie"] = `LEETCODE_SESSION=${session}; csrftoken=${csrf || ""}`;
      }

      const res = await fetch("https://leetcode.com/api/problems/all/", {
        credentials: "include",
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.num_solved && data.num_solved > 0) {
          totalSolved = data.num_solved;
          if (data.user_name) resolvedUser = data.user_name;

          const pairs = data.stat_status_pairs || [];
          for (const item of pairs) {
            if (item.status === "ac" && item.stat?.question__title_slug) {
              solvedSlugs.push(item.stat.question__title_slug);
            }
          }
        }
      }
    } catch {
      // Session fetch error fallback
    }

    // 2. Fallback to public GraphQL profile query if not logged in
    if (totalSolved === 0 && resolvedUser) {
      try {
        const query = `query getUserProfile($username: String!) {
          matchedUser(username: $username) {
            username
            submitStats: submitStatsGlobal {
              acSubmissionNum {
                difficulty
                count
              }
            }
          }
        }`;
        const res = await fetch("https://leetcode.com/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { username: resolvedUser } }),
        });

        if (res.ok) {
          const json = await res.json();
          const acList = json?.data?.matchedUser?.submitStats?.acSubmissionNum || [];
          const allItem = acList.find((x: any) => x.difficulty === "All");
          if (allItem?.count) {
            totalSolved = allItem.count;
          }
        }
      } catch {
        // GraphQL query error fallback
      }
    }

    // Calculate already pushed
    let alreadyPushed = 0;
    if (solvedSlugs.length > 0) {
      for (const slug of solvedSlugs) {
        if (syncedSet.has(slug.toLowerCase())) {
          alreadyPushed++;
        }
      }
    } else {
      alreadyPushed = Math.min(totalSolved, agentStats.byPlatform["leetcode"] || 0);
    }

    const needToPush = Math.max(0, totalSolved - alreadyPushed);

    return {
      platform: "leetcode",
      totalSolved,
      alreadyPushed,
      needToPush,
      username: resolvedUser,
      solvedSlugs,
      syncedSlugs: agentStats.syncedSlugs,
    };
  } else {
    // GeeksForGeeks
    let totalSolved = 0;
    const resolvedUser = username || "";

    if (resolvedUser) {
      try {
        const config = await getConfig();
        const res = await fetch(
          `${config.agentUrl.replace(/\/+$/, "")}/api/v1/platforms/gfg-stats?username=${encodeURIComponent(resolvedUser)}`,
          {
            headers: {
              Authorization: `Bearer ${config.bearerToken}`,
            },
          }
        );
        if (res.ok) {
          const json = await res.json();
          if (typeof json.totalSolved === "number") {
            totalSolved = json.totalSolved;
          }
        }
      } catch {
        // GFG stats fetch fallback
      }
    }

    const alreadyPushed = agentStats.byPlatform["gfg"] || 0;
    const needToPush = Math.max(0, totalSolved - alreadyPushed);

    return {
      platform: "gfg",
      totalSolved,
      alreadyPushed,
      needToPush,
      username: resolvedUser,
      solvedSlugs: [],
      syncedSlugs: agentStats.syncedSlugs,
    };
  }
}

/**
 * Fetches the source code of a specific LeetCode submission by ID via GraphQL.
 */
async function fetchSubmissionCode(
  submissionId: number,
  session: string,
  csrf?: string
): Promise<{ code?: string; lang?: string } | null> {
  try {
    const query = `query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        statusDisplay
        lang {
          name
        }
      }
    }`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: "https://leetcode.com",
      Referer: "https://leetcode.com/",
      Cookie: `LEETCODE_SESSION=${session}; csrftoken=${csrf || ""}`,
    };
    if (csrf) headers["x-csrftoken"] = csrf;

    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName: "submissionDetails",
        query,
        variables: { submissionId },
      }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const details = json?.data?.submissionDetails;
    if (details?.code) {
      return {
        code: details.code,
        lang: details.lang?.name || "python3",
      };
    }
  } catch (err) {
    console.warn(`[GrindSync] Failed to fetch submission code for ID ${submissionId}:`, err);
  }
  return null;
}

/**
 * Fetches the global difficulty mapping for all LeetCode problems in a single cached call.
 */
let cachedDiffMap: Map<string, Difficulty> | null = null;
async function getLeetCodeDifficultyMap(): Promise<Map<string, Difficulty>> {
  if (cachedDiffMap && cachedDiffMap.size > 0) return cachedDiffMap;
  const map = new Map<string, Difficulty>();
  try {
    const res = await fetch("https://leetcode.com/api/problems/all/");
    if (res.ok) {
      const data = await res.json();
      for (const item of data.stat_status_pairs || []) {
        const slug = item.stat?.question__title_slug;
        const level = item.difficulty?.level;
        if (slug && level) {
          const diff = level === 1 ? "Easy" : level === 2 ? "Medium" : "Hard";
          map.set(slug.toLowerCase(), diff as Difficulty);
        }
      }
    }
  } catch {
    // Non-fatal
  }
  cachedDiffMap = map;
  return map;
}

/**
 * Fetches difficulty for a LeetCode problem slug via GraphQL (public).
 */
async function fetchLeetCodeDifficulty(slug: string): Promise<Difficulty | undefined> {
  try {
    const query = `query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { difficulty } }`;
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { titleSlug: slug } }),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    const diff = data?.data?.question?.difficulty;
    if (diff === "Easy" || diff === "Medium" || diff === "Hard") {
      return diff as Difficulty;
    }
  } catch {
    // Non-fatal
  }
  return undefined;
}

/**
 * Fetches historical submissions from LeetCode using GraphQL, skipping already-pushed items.
 */
export async function fetchLeetCodeHistory(
  username?: string,
  alreadySyncedSlugs: string[] = [],
  pendingSlugs: string[] = [],
  onProgress?: (msg: string) => void
): Promise<SolutionSubmission[]> {
  const results: SolutionSubmission[] = [];
  const seenSlugs = new Set<string>();
  const alreadySyncedSet = new Set(alreadySyncedSlugs.map((s) => s.toLowerCase()));

  onProgress?.("Checking LeetCode login credentials in Chrome...");
  const { session, csrf } = await getLeetCodeSession();

  if (!session) {
    throw new Error(
      "LeetCode session not detected. Please log into https://leetcode.com in this Chrome browser so GrindSync can read your accepted solutions."
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: "https://leetcode.com",
    Referer: "https://leetcode.com/",
    Cookie: `LEETCODE_SESSION=${session}; csrftoken=${csrf || ""}`,
  };
  if (csrf) headers["x-csrftoken"] = csrf;

  // Strategy 1: Fast global submissionList crawl (in pages of 50)
  try {
    let offset = 0;
    const limit = 50;
    let hasNext = true;
    let page = 1;

    const listQuery = `query Submissions($offset: Int!, $limit: Int!) {
      submissionList(offset: $offset, limit: $limit) {
        lastKey
        hasNext
        submissions {
          id
          title
          titleSlug
          statusDisplay
          lang
          timestamp
        }
      }
    }`;

    while (hasNext && page <= 30) {
      onProgress?.(`Scanning LeetCode submission history page ${page}...`);

      const res = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers,
        body: JSON.stringify({
          operationName: "Submissions",
          query: listQuery,
          variables: { offset, limit },
        }),
      });

      if (!res.ok) break;
      const data = await res.json();
      const subList = data?.data?.submissionList;
      if (!subList || !subList.submissions || subList.submissions.length === 0) {
        break;
      }

      for (const item of subList.submissions) {
        if (item.statusDisplay !== "Accepted" && item.statusDisplay !== "accepted") {
          continue;
        }

        const slug = item.titleSlug || "unknown-problem";
        const lowerSlug = slug.toLowerCase();

        // Skip if already pushed to Git to avoid duplicates
        if (alreadySyncedSet.has(lowerSlug) || seenSlugs.has(lowerSlug)) {
          continue;
        }
        seenSlugs.add(lowerSlug);

        // Fetch submission source code
        onProgress?.(`Fetching code for "${item.title}" (${results.length + 1} found)...`);
        const subId = parseInt(item.id, 10);
        const codeDetails = await fetchSubmissionCode(subId, session, csrf);

        if (codeDetails && codeDetails.code) {
          const submittedAt = item.timestamp
            ? new Date(Number(item.timestamp) * 1000).toISOString()
            : new Date().toISOString();

          results.push({
            platform: "leetcode",
            problem: {
              title: item.title || slug,
              slug,
              url: `https://leetcode.com/problems/${slug}/`,
            },
            submission: {
              status: "accepted",
              language: codeDetails.lang || item.lang || "python3",
              code: codeDetails.code,
              submittedAt,
            },
          });
        }
      }

      hasNext = subList.hasNext ?? false;
      offset += limit;
      page++;
    }
  } catch (err) {
    console.warn("[GrindSync] Global submissionList crawl failed:", err);
  }

  // Strategy 2: If we have specific pending slugs not yet found in global history, query by questionSlug
  const missingSlugs = pendingSlugs.filter(
    (s) => !alreadySyncedSet.has(s.toLowerCase()) && !seenSlugs.has(s.toLowerCase())
  );

  if (missingSlugs.length > 0) {
    onProgress?.(`Checking ${missingSlugs.length} remaining pending problems directly...`);
    const problemQuery = `query ProblemSubmissions($slug: String!) {
      submissionList(offset: 0, limit: 3, questionSlug: $slug) {
        submissions {
          id
          title
          titleSlug
          statusDisplay
          lang
          timestamp
        }
      }
    }`;

    // Batch query missing slugs (up to 50 at a time to stay responsive)
    for (let i = 0; i < Math.min(missingSlugs.length, 50); i++) {
      const slug = missingSlugs[i];
      try {
        const res = await fetch("https://leetcode.com/graphql", {
          method: "POST",
          headers,
          body: JSON.stringify({
            operationName: "ProblemSubmissions",
            query: problemQuery,
            variables: { slug },
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const subs = json?.data?.submissionList?.submissions || [];
          const accepted = subs.find(
            (s: any) => s.statusDisplay === "Accepted" || s.statusDisplay === "accepted"
          );

          if (accepted && accepted.id) {
            seenSlugs.add(slug.toLowerCase());
            onProgress?.(`Fetching code for "${accepted.title || slug}" (${results.length + 1} found)...`);
            const subId = parseInt(accepted.id, 10);
            const codeDetails = await fetchSubmissionCode(subId, session, csrf);

            if (codeDetails && codeDetails.code) {
              const submittedAt = accepted.timestamp
                ? new Date(Number(accepted.timestamp) * 1000).toISOString()
                : new Date().toISOString();

              results.push({
                platform: "leetcode",
                problem: {
                  title: accepted.title || slug,
                  slug,
                  url: `https://leetcode.com/problems/${slug}/`,
                },
                submission: {
                  status: "accepted",
                  language: codeDetails.lang || accepted.lang || "python3",
                  code: codeDetails.code,
                  submittedAt,
                },
              });
            }
          }
        }
      } catch {
        // Individual question query fallback
      }
    }
  }

  // Enrich with difficulty for all items using global difficulty map
  const diffMap = await getLeetCodeDifficultyMap();
  for (const sub of results) {
    if (!sub.problem.difficulty) {
      const diff = diffMap.get(sub.problem.slug.toLowerCase());
      if (diff) {
        sub.problem.difficulty = diff;
      }
    }
  }

  // Any remaining without difficulty get fetched or fall back to Medium
  for (const sub of results) {
    if (!sub.problem.difficulty) {
      const diff = await fetchLeetCodeDifficulty(sub.problem.slug);
      sub.problem.difficulty = diff || "Medium";
    }
  }

  return results;
}

/**
 * Batch sends all fetched submissions to the local GrindSync agent.
 */
export async function sendBulkSubmissionsToAgent(
  submissions: SolutionSubmission[],
  onProgress?: (msg: string) => void
): Promise<BulkSubmissionResponse> {
  const config = await getConfig();
  const url = `${config.agentUrl.replace(/\/+$/, "")}/api/v1/submissions/bulk`;

  onProgress?.(`Dispatching ${submissions.length} solutions to local agent...`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify({
      submissions,
      repoPath: config.repoPath,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Agent returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const parsed = BulkSubmissionResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Invalid bulk submission response from agent");
  }

  return parsed.data;
}
