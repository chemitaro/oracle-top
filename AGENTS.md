# AGENTS.md

## Product boundary

- Canonical specifications are Japanese Markdown in docs/spec/.
- Implement only the approved requirements, design, and sequenced implementation plan.
- oracle-top is a read-only, offline viewer of Oracle metadata and browser lease registry.
- Never invoke Oracle, Chrome, CDP, network clients, file writes, lease cleanup, or process probes from the product.
- Do not add logs, history, notifications, detailed views, quota estimates, or custom session statuses.
- Preserve saved model and effort strings. Counts are Oracle submission-operation proxies, not account allowance evidence.

## Work

- Communicate concisely in Japanese. Inspect branch, HEAD, and worktree before editing and committing.
- Use use-workbench for ignored temporary artifacts. Never commit live Oracle data or full conversations.
- Use tdd for test-first implementation and integration tests. Run focused Red -> Green steps in docs/spec/implementation-plan.md.
- Complete each coherent verified step with explicit-path staging, complete staged-diff inspection, and commit-codex -a.
- Do not start implementation during specification authoring. Production writer target: GPT 6.1 Sol / High.
