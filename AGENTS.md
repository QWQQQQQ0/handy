<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules

- When a change affects the project architecture or adds new files, update `docs/PROJECT.md` to keep the architecture documentation in sync.
- Static system prompts must not be hardcoded. Place them in `src/config/system-prompts.json` instead.

