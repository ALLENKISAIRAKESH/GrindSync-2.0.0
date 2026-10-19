# Security Policy

CodeSync is designed with a strict **local-first, defense-in-depth security architecture**.

## Security Model & Trust Boundaries

```
[ Browser Extension ] (Untrusted context)
        │
        │ HTTP (Bearer Token, JSON validation)
        ▼
[ Local Fastify Agent ] (Trusted local context, strictly bound to 127.0.0.1)
   ├── SQLite Persistence (Local state & deduplication)
   ├── Filesystem / Path Sanitizer (Traversals blocked)
   ├── Targeted Git Service (No git add .)
   └── OpenAI Service (API Key strictly in local env)
```

---

## 1. Secrets & Credentials Isolation
- **No Browser-Side Secrets**: `OPENAI_API_KEY`, GitHub personal access tokens, and SSH keys are **never stored, embedded, or accessible within the browser extension**.
- **Agent-Side Keys**: The OpenAI API key is read strictly by the local background agent process via environment variables (`.env`).
- **Git Authentication**: CodeSync leverages your system's existing Git credential helper and SSH agent configurations. It never prompts for, stores, or transmits Git passwords.

---

## 2. Local Loopback Binding & CORS Protection
- The Fastify local agent binds strictly to `127.0.0.1` (loopback interface), preventing remote or LAN network access.
- All `/api/v1/*` endpoints require a matching `Bearer <token>` in the `Authorization` header.
- CORS policies explicitly permit only extension origins (`chrome-extension://*`) and local requests (`http://127.0.0.1`, `http://localhost`).

---

## 3. Path Traversal & Filesystem Safety
CodeSync automatically derives directories from problem titles and slugs. To prevent directory traversal and arbitrary file write attacks:
- All path segments are strictly sanitized using `sanitizeSegment()`.
- Windows-reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) are escaped.
- Illegal filename characters (`<>:"/\|?*+#%&={}^~[]\``) and control characters (`\x00-\x1F`) are replaced with dashes.
- `resolveSafeRepoPath()` validates that every resolved target file resides strictly within the user's configured repository root. Any attempt to escape via `..` throws a `SecurityError`.

---

## 4. Targeted Git Staging
- CodeSync **never executes `git add .` or blind workspace staging**.
- Only the exact solution file and README generated for the accepted submission are staged.
- Unrelated working tree changes in the user's repository remain completely untouched.

---

## 5. Reporting a Vulnerability
If you discover a potential security issue in CodeSync, please report it privately to the maintainers rather than opening a public issue.
