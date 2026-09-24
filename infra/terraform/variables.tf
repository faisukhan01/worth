# =============================================================================
# Variables - typed, documented, with sane defaults and validations.
# =============================================================================

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must be a valid AWS region identifier, e.g. us-east-1."
  }
}

variable "project_name" {
  description = "Short project slug used as a resource name prefix. Kept short so ALB/target-group names stay under the 32-character limit."
  type        = string
  default     = "lodestar"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,10}$", var.project_name))
    error_message = "project_name must be 3-11 characters: lowercase letters, digits, hyphens; must start with a letter."
  }
}

variable "environment" {
  description = "Deployment environment slug (e.g. dev, staging, prod)."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z0-9]{2,8}$", var.environment))
    error_message = "environment must be 2-8 lowercase alphanumeric characters."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. Must be a /16; public and private /20 subnets are carved from it."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && cidrnetmask(var.vpc_cidr) == "255.255.0.0"
    error_message = "vpc_cidr must be a valid /16 CIDR block, e.g. 10.0.0.0/16."
  }
}

variable "app_version" {
  description = "Application version stamp injected into containers (NEXT_PUBLIC_APP_VERSION)."
  type        = string
  default     = "0.1.0"
}

variable "web_image" {
  description = "Container image for the Next.js web dashboard."
  type        = string
  default     = "ghcr.io/lodestar-oss/lodestar-web:0.1.0"
}

variable "gateway_image" {
  description = "Container image for the Go ingest gateway."
  type        = string
  default     = "ghcr.io/lodestar-oss/lodestar-gateway:0.1.0"
}

variable "aiops_image" {
  description = "Container image for the Python AIOps engine."
  type        = string
  default     = "ghcr.io/lodestar-oss/lodestar-aiops:0.1.0"
}

variable "web_desired_count" {
  description = "Number of web tasks to keep running."
  type        = number
  default     = 2

  validation {
    condition     = var.web_desired_count >= 1 && var.web_desired_count <= 10
    error_message = "web_desired_count must be between 1 and 10."
  }
}

variable "gateway_desired_count" {
  description = "Number of ingest-gateway tasks to keep running."
  type        = number
  default     = 2

  validation {
    condition     = var.gateway_desired_count >= 1 && var.gateway_desired_count <= 10
    error_message = "gateway_desired_count must be between 1 and 10."
  }
}

variable "aiops_desired_count" {
  description = "Number of aiops-engine tasks to keep running."
  type        = number
  default     = 1

  validation {
    condition     = var.aiops_desired_count >= 1 && var.aiops_desired_count <= 10
    error_message = "aiops_desired_count must be between 1 and 10."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for service log groups."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 7, 14, 30, 60, 90, 180, 365, 731, 1827, 3653], var.log_retention_days)
    error_message = "log_retention_days must be one of: 1, 3, 7, 14, 30, 60, 90, 180, 365, 731, 1827, 3653."
  }
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the ALB HTTPS listener. Empty string disables HTTPS (placeholder listener is skipped)."
  type        = string
  default     = ""

  validation {
    condition     = var.acm_certificate_arn == "" || can(regex("^arn:aws:acm:", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be empty or a valid ACM certificate ARN (arn:aws:acm:...)."
  }
}

variable "container_insights" {
  description = "Enable ECS Container Insights on the cluster."
  type        = bool
  default     = false
}
