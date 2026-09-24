# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately to the maintainers:

- Email: `security@lodestar.example.com`
- Please include: affected component(s) and version/commit, a description,
  reproduction steps or a proof of concept, and your assessment of impact.

You will receive an acknowledgment within 2 business days. We will coordinate
a fix, keep you informed, and credit you in the release notes unless you
prefer to remain anonymous. Please allow up to 90 days for disclosure
coordination.

## Supported versions

| Version | Branch | Supported |
| ------- | ------ | --------- |
| 0.1.x   | main   | yes       |
| < 0.1.0 | -      | no (pre-release) |

## Scope and guarantees

In scope: all services in this monorepo (`web`, `ingest-gateway`,
`aiops-engine`, `billing-core`, `reporting`, `pulseagent`), the platform
artifacts (Dockerfiles, compose, k8s manifests, Terraform), and CI workflows.

Key platform security properties:

- **API key auth** on ingest endpoints (`x-api-key`, `pg_live_*` in dev).
  Rotate keys for production; never commit them (`.env*` is gitignored,
  k8s secrets are templated in `k8s/base/secret.example.yaml`).
- **Containers run as non-root** (web: uid 1001 `nextjs`; k8s manifests
  enforce `runAsNonRoot`, dropped capabilities, `seccompProfile: RuntimeDefault`).
- **Least-privilege networking**: k8s Services are ClusterIP; the Terraform
  module uses explicit SG rules (tasks egress 443 only; ALB talks only to
  declared service ports).
- **Supply chain**: Dependabot across all ecosystems, CodeQL scanning
  (go, java-kotlin, python, csharp) on main + weekly, pinned action versions.
- **No secrets in images**: `.dockerignore` excludes `.env*`, databases, and
  toolchains from build contexts.

## Out of scope

- Denial of service via volumetric traffic.
- Vulnerabilities in third-party dependencies reported without a
  corresponding Lodestar impact.
- Issues requiring access to a developer machine or CI secrets.

## Hardening checklist for operators

1. Replace `pg_live_demo_key` with production keys (Secrets Manager / SSM).
2. Point `DATABASE_URL` at managed Postgres (ADR-004) instead of SQLite.
3. Enable the ALB HTTPS listener (`acm_certificate_arn`) and redirect HTTP.
4. Restrict ingress `loadBalancerSourceRanges` / SG ingress to known networks.
5. Keep CloudWatch log retention tight (`log_retention_days`) to limit PII
   residency.
