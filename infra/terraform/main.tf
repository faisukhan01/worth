# =============================================================================
# Lodestar - AWS foundation for the observability platform (ECS Fargate).
#
# Provisions:
#   - VPC (10.0.0.0/16) with 2 public + 2 private subnets across 2 AZs
#   - Internet gateway, single NAT gateway (cost-conscious default)
#   - ECS Fargate cluster + task definitions for web / ingest-gateway / aiops
#   - ECS services with Cloud Map service discovery (internal DNS)
#   - Public ALB + target groups + HTTP listener (+ HTTPS listener once an
#     ACM certificate ARN is provided via var.acm_certificate_arn)
#   - Security groups with explicit ingress/egress rules
#   - CloudWatch log groups with configurable retention
#
# State: see README.md in this directory (S3 backend + DynamoDB lock table).
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state (recommended). Uncomment and configure before first apply,
  # then run `terraform init`. The bucket/table must already exist.
  #
  # backend "s3" {
  #   bucket         = "lodestar-tfstate-<account-id>"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "lodestar-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  # Two /20 public subnets (10.0.0.0/20, 10.0.1.0/20) and two /20 private
  # subnets (10.0.10.0/20, 10.0.11.0/20) carved from the /16.
  public_subnet_cidrs  = [for i in range(2) : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnet_cidrs = [for i in range(2) : cidrsubnet(var.vpc_cidr, 8, i + 10)]

  internal_dns = "${aws_service_discovery_private_dns_namespace.main.name}"
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = local.public_subnet_cidrs[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = local.private_subnet_cidrs[count.index]

  tags = {
    Name = "${local.name_prefix}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

# Public routing: default route to the internet gateway.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name_prefix}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Single NAT gateway in the first public subnet (cost-conscious default;
# move to one NAT per AZ for production HA).
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = { Name = "${local.name_prefix}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = { Name = "${local.name_prefix}-nat" }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "${local.name_prefix}-private-rt" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# -----------------------------------------------------------------------------
# Security groups - explicit rules only, no default allow-all egress reuse.
# -----------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB: accept public HTTP/HTTPS, egress only to Lodestar service ports"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-alb-sg" }
}

resource "aws_security_group_rule" "alb_ingress_http" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  description       = "Public HTTP"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "alb_ingress_https" {
  type              = "ingress"
  security_group_id = aws_security_group.alb.id
  description       = "Public HTTPS"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "alb_egress_web" {
  type                     = "egress"
  security_group_id        = aws_security_group.alb.id
  description              = "ALB to web containers"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.services.id
}

resource "aws_security_group_rule" "alb_egress_gateway" {
  type                     = "egress"
  security_group_id        = aws_security_group.alb.id
  description              = "ALB to ingest-gateway containers"
  from_port                = 3100
  to_port                  = 3100
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.services.id
}

resource "aws_security_group_rule" "alb_egress_aiops" {
  type                     = "egress"
  security_group_id        = aws_security_group.alb.id
  description              = "ALB to aiops-engine containers"
  from_port                = 3200
  to_port                  = 3200
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.services.id
}

resource "aws_security_group" "services" {
  name        = "${local.name_prefix}-svc-sg"
  description = "Lodestar tasks: ingress from ALB and intra-platform, egress 443 only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-svc-sg" }
}

resource "aws_security_group_rule" "svc_ingress_web_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.services.id
  description              = "web from ALB"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "svc_ingress_gateway_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.services.id
  description              = "ingest-gateway from ALB"
  from_port                = 3100
  to_port                  = 3100
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "svc_ingress_aiops_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.services.id
  description              = "aiops-engine from ALB"
  from_port                = 3200
  to_port                  = 3200
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

# Intra-platform traffic: aiops pulls from the gateway, web proxies to both.
resource "aws_security_group_rule" "svc_ingress_gateway_from_services" {
  type                     = "ingress"
  security_group_id        = aws_security_group.services.id
  description              = "ingest-gateway from other Lodestar tasks"
  from_port                = 3100
  to_port                  = 3100
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.services.id
}

resource "aws_security_group_rule" "svc_ingress_aiops_from_services" {
  type                     = "ingress"
  security_group_id        = aws_security_group.services.id
  description              = "aiops-engine from other Lodestar tasks"
  from_port                = 3200
  to_port                  = 3200
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.services.id
}

# Tasks live in private subnets and reach ECR/SSM/CloudWatch over 443.
resource "aws_security_group_rule" "svc_egress_https" {
  type              = "egress"
  security_group_id = aws_security_group.services.id
  description       = "ECR image pulls, SSM, CloudWatch endpoints"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}

# -----------------------------------------------------------------------------
# ECS cluster, logging, IAM
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }

  tags = { Name = "${local.name_prefix}-cluster" }
}

resource "aws_cloudwatch_log_group" "services" {
  for_each = toset(["web", "ingest-gateway", "aiops-engine"])

  name              = "/ecs/${local.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days

  tags = { Name = "/ecs/${local.name_prefix}/${each.key}" }
}

resource "aws_iam_role" "task_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Runtime (task) role placeholder - attach least-privilege policies per service
# as integrations grow (S3 exports, SSM, etc.).
resource "aws_iam_role" "task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Cloud Map - internal DNS for task-to-task calls (private DNS namespace).
# -----------------------------------------------------------------------------

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${local.name_prefix}.internal"
  description = "Internal service discovery for Lodestar tasks"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "gateway" {
  name = "ingest-gateway"

  namespace_id = aws_service_discovery_private_dns_namespace.main.id

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }
}

resource "aws_service_discovery_service" "aiops" {
  name = "aiops-engine"

  namespace_id = aws_service_discovery_private_dns_namespace.main.id

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }
}

# -----------------------------------------------------------------------------
# Task definitions
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = var.web_image
      essential = true

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "PORT", value = "3000" },
        { name = "NODE_ENV", value = "production" },
        # SQLite on ephemeral task storage - sandbox default. Production should
        # point DATABASE_URL at managed Postgres (ARCHITECTURE.md ADR-004).
        { name = "DATABASE_URL", value = "file:/tmp/custom.db" },
        { name = "GATEWAY_URL", value = "http://ingest-gateway.${local.internal_dns}:3100" },
        { name = "AIOPS_URL", value = "http://aiops-engine.${local.internal_dns}:3200" },
        { name = "NEXT_PUBLIC_APP_VERSION", value = var.app_version }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.services["web"].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
    }
  ])

  tags = { Name = "${local.name_prefix}-web" }
}

resource "aws_ecs_task_definition" "gateway" {
  family                   = "${local.name_prefix}-ingest-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "ingest-gateway"
      image     = var.gateway_image
      essential = true

      portMappings = [
        {
          containerPort = 3100
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "PORT", value = "3100" },
        { name = "LOG_LEVEL", value = "info" },
        # Demo key per API contract. For production, move this to `secrets`
        # sourced from SSM Parameter Store / Secrets Manager.
        { name = "API_KEYS", value = "pg_live_demo_key" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.services["ingest-gateway"].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "gateway"
        }
      }
    }
  ])

  tags = { Name = "${local.name_prefix}-ingest-gateway" }
}

resource "aws_ecs_task_definition" "aiops" {
  family                   = "${local.name_prefix}-aiops-engine"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "aiops-engine"
      image     = var.aiops_image
      essential = true

      portMappings = [
        {
          containerPort = 3200
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "PORT", value = "3200" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "GATEWAY_URL", value = "http://ingest-gateway.${local.internal_dns}:3100" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.services["aiops-engine"].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "aiops"
        }
      }
    }
  ])

  tags = { Name = "${local.name_prefix}-aiops-engine" }
}

# -----------------------------------------------------------------------------
# Load balancer, target groups, listeners
# -----------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "${local.name_prefix}-alb" }
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name_prefix}-web-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name_prefix}-web-tg" }
}

resource "aws_lb_target_group" "gateway" {
  name        = "${local.name_prefix}-gateway-tg"
  port        = 3100
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/v1/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name_prefix}-gateway-tg" }
}

resource "aws_lb_target_group" "aiops" {
  name        = "${local.name_prefix}-aiops-tg"
  port        = 3200
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/v1/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name_prefix}-aiops-tg" }
}

# HTTP listener: default to the web dashboard; path rules below.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# HTTPS listener placeholder: created only once an ACM certificate ARN is set
# (terraform apply -var="acm_certificate_arn=arn:aws:acm:..."). The HTTP
# listener intentionally keeps forwarding (sandbox); switch it to a 301
# redirect for production.
resource "aws_lb_listener" "https" {
  count = var.acm_certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# Routing priority:
#   90:  /v1/insights*  -> aiops-engine (public insights read endpoint)
#   100: /v1/*          -> ingest-gateway (ingest + query + SSE)
# Everything else falls through to web (dashboard + /api/* routes).
resource "aws_lb_listener_rule" "aiops_http" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 90

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.aiops.arn
  }

  condition {
    path_pattern {
      values = ["/v1/insights*"]
    }
  }
}

resource "aws_lb_listener_rule" "gateway_http" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }

  condition {
    path_pattern {
      values = ["/v1/*"]
    }
  }
}

resource "aws_lb_listener_rule" "aiops_https" {
  count = var.acm_certificate_arn != "" ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 90

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.aiops.arn
  }

  condition {
    path_pattern {
      values = ["/v1/insights*"]
    }
  }
}

resource "aws_lb_listener_rule" "gateway_https" {
  count = var.acm_certificate_arn != "" ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }

  condition {
    path_pattern {
      values = ["/v1/*"]
    }
  }
}

# -----------------------------------------------------------------------------
# ECS services
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.services.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  health_check_grace_period_seconds = 30

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "gateway" {
  name            = "ingest-gateway"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.gateway.arn
  desired_count   = var.gateway_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.services.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.gateway.arn
    container_name   = "ingest-gateway"
    container_port   = 3100
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.gateway.arn
    container_name = "ingest-gateway"
    container_port = 3100
  }

  health_check_grace_period_seconds = 30

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "aiops" {
  name            = "aiops-engine"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.aiops.arn
  desired_count   = var.aiops_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.services.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.aiops.arn
    container_name   = "aiops-engine"
    container_port   = 3200
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.aiops.arn
    container_name = "aiops-engine"
    container_port = 3200
  }

  health_check_grace_period_seconds = 30

  depends_on = [aws_lb_listener.http]
}
