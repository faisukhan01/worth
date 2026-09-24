<!--
  Title convention: <type>(<scope>): <short summary>
  e.g. feat(gateway): add SSE backpressure, fix(aiops): clamp z-score threshold
-->

## Summary

<!-- What does this PR change and why? One or two sentences. -->

## Changes

<!-- Bullet list of concrete changes. -->

-
-

## Stack(s) touched

- [ ] web (Next.js / bun)
- [ ] ingest-gateway (Go)
- [ ] aiops-engine (Python)
- [ ] billing-core (Java / Spring Boot)
- [ ] reporting (C# / .NET)
- [ ] mobile (Flutter)
- [ ] edge / pulseagent (C)
- [ ] platform (CI/CD, k8s, terraform, compose, docs)

## Checklist

- [ ] Conventional-commit title (see above)
- [ ] `make lint` passes for every touched stack
- [ ] Build succeeds locally (`make build` or per-stack command)
- [ ] API contracts from `docs/api-contracts.md` unchanged (or updated + approved)
- [ ] No test files added (project rule: CI builds/lints only)
- [ ] Configs syntactically valid (YAML/HCL/JSON)
- [ ] Docs updated (`docs/`, `ARCHITECTURE.md`) if behavior/ports/contracts changed
- [ ] No secrets or real keys committed (use `.env.example` placeholders)
