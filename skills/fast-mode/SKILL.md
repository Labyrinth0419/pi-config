---
name: fast-mode
description: Route implementation work to the worker-fast subagent with provider service_tier=priority. Use when the user requests a fast or priority child, when choosing a priority model for delegated work, or when configuring and explaining worker-fast.
---

# Fast-mode subagent routing

Use `worker-fast` when implementation work should run on the provider priority service tier without enabling `/fast` for the parent session.

## Invocation

Always select the intended child model explicitly when practical:

```ts
subagent({
  agent: "worker-fast",
  model: "labyrinth/gpt-6-sol:max",
  task: "Implement and verify the requested change."
})
```

Other registered models may be selected per run, for example:

- `labyrinth/gpt-6-luna:max`
- `labyrinth/gpt-5.6-sol:max`
- `labyrinth/gpt-5.6-luna:max`
- `labyrinth/gpt-5.6-terra:max`

These examples are not a whitelist. `worker-fast` does not restrict the model; the selected provider remains responsible for accepting or rejecting `service_tier`.

If the caller omits `model`, `worker-fast` safely defaults to `labyrinth/gpt-6-sol:max`. Prefer an explicit model so cost and capability are intentional.

## Required semantics

- `worker-fast` itself means priority tier. Use ordinary `worker` when priority is not wanted.
- Never pass `fast: true` to `worker-fast`. Pi-subagents native fast mode performs its own `openai-codex/*` validation and is unrelated to this agent's child-only extension.
- Parent `/fast` state is independent. Invoking `worker-fast` must not enable priority for the parent or other agents.
- The child-only extension applies `service_tier: "priority"` to every provider request in the child, including turns after tool calls and retries.
- Priority tier does not choose a model or thinking level. Those are controlled by `model` and its optional thinking suffix.
- Do not set an empty `extensions:` field on `worker-fast`; that can disable ambient provider extensions needed by the selected model.

## Routing policy

Choose `worker-fast` when the user explicitly requests priority/fast child execution, or when reliable quota/cost information supplied by a tool or the user makes priority appropriate. Otherwise use ordinary `worker`.

A skill cannot discover remaining provider quota by itself. Do not claim dynamic quota awareness unless a trusted quota API, tool result, or user-provided value is available.

## Implementation boundary

The request-rewrite extension is `scripts/priority-service-tier.ts` and is loaded only through `worker-fast.md` via `subagentOnlyExtensions`.

Do not move or copy that script into `~/.pi/agent/extensions/`, do not add it to global extension settings, and do not import pi-subagents internal source files. Those changes could affect the parent session or make the integration dependent on pi-subagents implementation details.
