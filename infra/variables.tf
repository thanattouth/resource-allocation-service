variable "aws_region" {
  description = "AWS region for Learner Lab resources."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short project name used for tagging and naming resources."
  type        = string
  default     = "resource-allocation"
}

variable "environment" {
  description = "Environment suffix for resource names."
  type        = string
  default     = "learnerlab"
}

variable "preferred_availability_zone" {
  description = "Availability Zone to use for the EC2 host in Learner Lab."
  type        = string
  default     = "us-east-1a"
}

variable "ec2_instance_type" {
  description = "EC2 instance type for the always-on app host."
  type        = string
  default     = "t3.micro"
}

variable "ssh_ingress_cidr_blocks" {
  description = "CIDR blocks allowed to SSH into EC2."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "app_ingress_cidr_blocks" {
  description = "CIDR blocks allowed to reach the application port on EC2."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "public_key_path" {
  description = "Path to the SSH public key that will be imported as an EC2 key pair."
  type        = string
}

variable "ec2_key_pair_name" {
  description = "Name of the EC2 key pair to create."
  type        = string
  default     = "resource-allocation-ec2-key"
}

variable "existing_instance_profile_name" {
  description = "Existing EC2 instance profile name provided by AWS Learner Lab."
  type        = string
  default     = "LabInstanceProfile"
}

variable "container_image_tag" {
  description = "Docker image tag that EC2 should pull from ECR."
  type        = string
  default     = "latest"
}

variable "existing_rds_host" {
  description = "Existing RDS endpoint hostname to reuse."
  type        = string
}

variable "existing_rds_port" {
  description = "Existing RDS port."
  type        = number
  default     = 5432
}

variable "existing_rds_name" {
  description = "Database name in the existing RDS instance."
  type        = string
}

variable "existing_rds_username" {
  description = "Database username for the existing RDS instance."
  type        = string
}

variable "existing_rds_password" {
  description = "Database password for the existing RDS instance."
  type        = string
  sensitive   = true
}

variable "existing_rds_security_group_id" {
  description = "Security group ID attached to the existing RDS instance. Used to allow access from the new EC2 host."
  type        = string
}

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB table used for idempotency."
  type        = string
  default     = "resource-allocation-idempotency"
}

variable "idempotency_ttl_hours" {
  description = "TTL in hours for idempotency records."
  type        = number
  default     = 24
}

variable "app_port" {
  description = "Application port exposed by the Docker container on EC2."
  type        = number
  default     = 3000
}

variable "powergrid_eta_queue_name" {
  description = "SQS queue name for resource.events.powergrid_eta_updated."
  type        = string
  default     = "resource-events-powergrid-eta-updated"
}

variable "powergrid_eta_dlq_name" {
  description = "SQS dead-letter queue name for powergrid ETA events."
  type        = string
  default     = "resource-events-powergrid-eta-updated-dlq"
}

variable "shelter_transporting_queue_name" {
  description = "SQS queue name for resource.events.shelter_transporting."
  type        = string
  default     = "resource-events-shelter-transporting"
}

variable "shelter_transporting_dlq_name" {
  description = "SQS dead-letter queue name for shelter transporting events."
  type        = string
  default     = "resource-events-shelter-transporting-dlq"
}

variable "lambda_role_name" {
  description = "Existing IAM role name for the nearby Lambda function in AWS Learner Lab."
  type        = string
  default     = "LabRole"
}

variable "nearby_lambda_package_path" {
  description = "Path to the packaged nearby Lambda zip file."
  type        = string
  default     = "../dist/nearby-lambda.zip"
}

variable "nearby_lambda_timeout_seconds" {
  description = "Timeout for the nearby Lambda function."
  type        = number
  default     = 10
}

variable "nearby_lambda_memory_mb" {
  description = "Memory size for the nearby Lambda function."
  type        = number
  default     = 512
}

variable "lambda_log_retention_days" {
  description = "Retention period for Lambda and API Gateway CloudWatch logs."
  type        = number
  default     = 7
}

variable "lambda_db_connect_timeout_ms" {
  description = "Database connection timeout for the nearby Lambda function."
  type        = number
  default     = 5000
}

variable "lambda_db_query_timeout_ms" {
  description = "Database statement timeout for the nearby Lambda function."
  type        = number
  default     = 3000
}

variable "lambda_db_pool_max" {
  description = "Maximum pg pool size inside the nearby Lambda execution environment."
  type        = number
  default     = 2
}

variable "lambda_db_ssl_enabled" {
  description = "Whether the nearby Lambda should connect to PostgreSQL using SSL."
  type        = bool
  default     = false
}

variable "dispatcher_bearer_token" {
  description = "Dispatcher bearer token accepted by nearby Lambda."
  type        = string
  sensitive   = true
}

variable "nearby_api_throttling_burst_limit" {
  description = "Burst limit for the nearby HTTP API stage."
  type        = number
  default     = 20
}

variable "nearby_api_throttling_rate_limit" {
  description = "Steady-state request rate limit for the nearby HTTP API stage."
  type        = number
  default     = 10
}
