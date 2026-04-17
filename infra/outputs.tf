output "ecr_repository_url" {
  description = "ECR repository URL for pushing the application Docker image."
  value       = aws_ecr_repository.app.repository_url
}

output "ec2_public_ip" {
  description = "Public IP address of the application EC2 instance."
  value       = aws_instance.app.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS of the application EC2 instance."
  value       = aws_instance.app.public_dns
}

output "ec2_security_group_id" {
  description = "Security group attached to the EC2 instance."
  value       = aws_security_group.ec2_app.id
}

output "dynamodb_table_name" {
  description = "DynamoDB table used for idempotency records."
  value       = aws_dynamodb_table.idempotency.name
}

output "container_image_uri" {
  description = "Expected image URI that EC2 user-data tries to pull."
  value       = local.container_image_uri
}

output "sqs_powergrid_eta_updated_url" {
  description = "SQS URL for resource.events.powergrid_eta_updated."
  value       = aws_sqs_queue.powergrid_eta.url
}

output "sqs_powergrid_eta_updated_dlq_url" {
  description = "SQS DLQ URL for resource.events.powergrid_eta_updated."
  value       = aws_sqs_queue.powergrid_eta_dlq.url
}

output "sqs_shelter_transporting_url" {
  description = "SQS URL for resource.events.shelter_transporting."
  value       = aws_sqs_queue.shelter_transporting.url
}

output "sqs_shelter_transporting_dlq_url" {
  description = "SQS DLQ URL for resource.events.shelter_transporting."
  value       = aws_sqs_queue.shelter_transporting_dlq.url
}
