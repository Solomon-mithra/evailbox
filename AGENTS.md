<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Task completion and Git workflow

- When a major task or requirement is complete and its relevant checks pass, commit the changes and push them to the branch used for that task as part of completing the work. Do not wait for a separate request to commit or push.
- Keep commits focused on the completed task. Do not include unrelated changes, secrets, or local environment files.
- Push to the branch's configured upstream. If it has no upstream, push the task branch to `origin` and set its upstream. Do not switch branches, merge into another branch, or force-push unless explicitly requested.
- Report the commit and branch after a successful push. If checks, the commit, or the push fail, explain the blocker and do not claim the task has been fully delivered.
