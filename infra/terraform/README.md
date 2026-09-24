# Lodestar Terraform - AWS foundation

Provisions the AWS foundation for the Lodestar platform on **ECS Fargate**:
VPC (2 public + 2 private subnets, 2 AZs), IGW + single NAT gateway, ECS
cluster with task definitions/services for `web`, `ingest-gateway` and
`aiops-engine`, Cloud Map internal DNS, a public ALB with path-based routing,
explicit security-group rules, and CloudWatch log groups with retention.

Billing-core, reporting and the pulseagent run as code-tier services and are
not part of this module's task definitions (add them following the same
pattern when they need managed hosting).

## Files

| File                      | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `main.tf`                 | Providers, VPC, ECS, ALB, SGs, logging, discovery    |
| `variables.tf`            | Typed variables with descriptions and validations    |
| `outputs.tf`              | ALB DNS, cluster name, VPC id, log groups, etc.      |
| `terraform.tfvars.example`| Copy to `terraform.tfvars` and adjust                |

## Remote state (S3 + DynamoDB lock) - required setup

State should live in S3 with locking in DynamoDB. The `backend "s3"` block in
`main.tf` is shipped **commented out**; configure and uncomment it before the
first apply. One-time bootstrap (outside Terraform, e.g. AWS CLI):

```sh
aws s3api create-bucket \
  --bucket lodestar-tfstate-<account-id> \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket lodestar-tfstate-<account-id> \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name lodestar-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Then uncomment and fill the backend block:

```hcl
backend "s3" {
  bucket         = "lodestar-tfstate-<account-id>"
  key            = "prod/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "lodestar-tflock"
  encrypt        = true
}
```

## Plan and apply

```sh
cd infra/terraform

cp terraform.tfvars.example terraform.tfvars   # then edit values

terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Useful outputs after apply:

```sh
terraform output alb_dns_name        # point Route53 / DNS at this
terraform output cluster_name
terraform output internal_service_domain
```

## Enabling HTTPS

The ALB HTTPS listener and its `/v1/*` routing rules are a **placeholder**:
they are only created when `acm_certificate_arn` is set to a valid ACM
certificate ARN (certificate must be in the same region as the ALB).

```sh
terraform apply -var="acm_certificate_arn=arn:aws:acm:us-east-1:<acct>:certificate/<id>"
```

For production, also change the HTTP listener to a 301 redirect to HTTPS.

## Cost and HA notes

- Single NAT gateway by default (~saves 1 NAT gateway hour + data). For HA,
  create one NAT per AZ and split the private route tables.
- Log retention defaults to 30 days (`log_retention_days`).
- `container_insights = true` adds CloudWatch Container Insights cost.

## Teardown

```sh
terraform destroy   # drains ECS services, removes VPC/ALB/log groups
```

The S3 state bucket and DynamoDB lock table are intentionally not managed by
this module and survive `destroy`.
