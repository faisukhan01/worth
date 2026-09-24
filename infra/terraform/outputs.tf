# =============================================================================
# Outputs - the values operators need after apply.
# =============================================================================

output "alb_dns_name" {
  description = "Public DNS name of the Application Load Balancer. Point Route53 at this."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 zone id of the ALB (for alias A records)."
  value       = aws_lb.main.zone_id
}

output "cluster_name" {
  description = "Name of the ECS Fargate cluster."
  value       = aws_ecs_cluster.main.name
}

output "vpc_id" {
  description = "ID of the platform VPC."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets where tasks run."
  value       = aws_subnet.private[*].id
}

output "internal_service_domain" {
  description = "Cloud Map private DNS namespace for task-to-task calls (ingest-gateway.<domain>:3100, aiops-engine.<domain>:3200)."
  value       = aws_service_discovery_private_dns_namespace.main.name
}

output "ecs_task_security_group_id" {
  description = "Security group attached to all Lodestar ECS tasks."
  value       = aws_security_group.services.id
}

output "cloudwatch_log_groups" {
  description = "CloudWatch log group names per service."
  value       = { for k, v in aws_cloudwatch_log_group.services : k => v.name }
}
