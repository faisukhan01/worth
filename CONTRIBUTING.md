# Contributing to Lodestar

Thanks for contributing. Keep PRs small, contracts stable, and CI green.

## Branch naming

Branch off `main` using one of these prefixes:

| Prefix      | Use for                                       | Example                          |
| ----------- | --------------------------------------------- | -------------------------------- |
| `feat/`     | new features                                  | `feat/gateway-sse-backpressure`  |
| `fix/`      | bug fixes                                     | `fix/aiops-poll-timeout`         |
| `chore/`    | tooling, deps, CI, docs                       | `chore/bump-bun-version`         |
| `docs/`     | documentation only                            | `docs/operations-runbook`        |
| `refactor/` | restructuring with no behavior change         | `refactor/web-api-routes`        |

Suffix with the stack or issue number when helpful: `fix/3100-gateway-401`.

## Conventional commits

Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) spec:

```
<type>(<scope>): <short summary in imperative mood>

[optional body]
[optional footer(s)]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `ci`, `build`.
Scopes: `web`, `gateway`, `aiops`, `billing`, `reporting`, `mobile`,
`agent`, `platform`, `docs`.

Examples:

```
feat(gateway): add backpressure to the SSE stream
fix(aiops): clamp z-score threshold to 3.5
chore(platform): pin terraform aws provider to ~> 5.0
docs: document /v1/insights response shape
```

## Project rules (non-negotiable)

1. **No test files.** The project explicitly ships without tests; CI does
   build + lint only. Do not add test files or test runners.
2. **Do not drift API contracts.** `docs/api-contracts.md` is authoritative.
   Contract changes must update that file and all consumers in the same PR.
3. **No emojis, ASCII only** in code, configs and docs.
4. **Configs must be syntactically valid** (YAML/HCL/JSON) - a platform
   engineer should be able to review and apply them.
5. **No secrets in git.** Use `.env.example` placeholders and k8s
   `secret.example.yaml`-style templates.

## Local development

```sh
make help       # list targets
make dev-web    # Next.js on :3000
make dev-gateway
make dev-aiops
make build      # build all stacks present
make lint       # lint all stacks present
```

See `docs/operations.md` for the full runbook and port map.

## PR checklist

- [ ] Title is a conventional commit (`type(scope): summary`)
- [ ] `make lint` passes for every touched stack
- [ ] `make build` (or per-stack build) succeeds
- [ ] No test files added (project rule)
- [ ] API contract changes reflected in `docs/api-contracts.md`
- [ ] Docs updated (`docs/`, `ARCHITECTURE.md`, `CHANGELOG.md`) when relevant
- [ ] No secrets, API keys, or local artifacts committed
- [ ] Stack(s) touched are checked in the PR template

## Code style

- `.editorconfig` governs indentation (spaces by default, tabs for Go/Java/Make).
- Web: ESLint (`bun run lint`) must pass.
- Go: `go vet ./...` must be clean; gofmt-formatted.
- Python: `ruff check .` must be clean.
- Keep dependencies minimal (the gateway is deliberately zero-dependency, ADR-002).

## Reporting issues

Use the GitHub issue templates (`.github/ISSUE_TEMPLATE/`). Security issues
follow `SECURITY.md` - do not open public issues for them.
