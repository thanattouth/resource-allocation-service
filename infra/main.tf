locals {
  name_prefix         = "${var.project_name}-${var.environment}"
  ecr_repository      = "${local.name_prefix}-app"
  idempotency_ttl_s   = var.idempotency_ttl_hours * 60 * 60
  container_image_uri = "${aws_ecr_repository.app.repository_url}:${var.container_image_tag}"
  db_host             = var.create_rds ? aws_db_instance.app[0].address : var.existing_rds_host
  db_port             = var.create_rds ? aws_db_instance.app[0].port : var.existing_rds_port
  db_name             = var.create_rds ? var.rds_db_name : var.existing_rds_name
  db_username         = var.create_rds ? var.rds_username : var.existing_rds_username
  db_password         = var.create_rds ? var.rds_password : var.existing_rds_password
  db_security_group_id = (
    var.create_rds ? aws_security_group.rds[0].id : var.existing_rds_security_group_id
  )
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "availability-zone"
    values = [var.preferred_availability_zone]
  }
}

data "aws_subnets" "default_all" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_security_group" "rds" {
  count       = var.create_rds ? 1 : 0
  name        = "${local.name_prefix}-rds-sg"
  description = "Security group for Resource Allocation PostgreSQL RDS"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name_prefix}-rds-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_db_subnet_group" "app" {
  count      = var.create_rds ? 1 : 0
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = data.aws_subnets.default_all.ids

  tags = {
    Name        = "${local.name_prefix}-db-subnets"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_db_instance" "app" {
  count = var.create_rds ? 1 : 0

  identifier              = "${local.name_prefix}-postgres"
  engine                  = "postgres"
  instance_class          = var.rds_instance_class
  allocated_storage       = var.rds_allocated_storage_gb
  max_allocated_storage   = var.rds_max_allocated_storage_gb
  storage_type            = var.rds_storage_type
  db_name                 = var.rds_db_name
  username                = var.rds_username
  password                = var.rds_password
  port                    = var.existing_rds_port
  db_subnet_group_name    = aws_db_subnet_group.app[0].name
  vpc_security_group_ids  = [aws_security_group.rds[0].id]
  publicly_accessible     = false
  multi_az                = false
  backup_retention_period = var.rds_backup_retention_days
  deletion_protection     = var.rds_deletion_protection
  skip_final_snapshot     = true
  apply_immediately       = true

  tags = {
    Name        = "${local.name_prefix}-postgres"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_ecr_repository" "app" {
  name                 = local.ecr_repository
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = local.ecr_repository
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "idempotency" {
  name         = var.dynamodb_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "idempotency_key"

  attribute {
    name = "idempotency_key"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name        = var.dynamodb_table_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "powergrid_completed_dlq" {
  name = var.powergrid_completed_dlq_name

  tags = {
    Name        = var.powergrid_completed_dlq_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "powergrid_completed" {
  name                       = var.powergrid_completed_queue_name
  visibility_timeout_seconds = 30
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.powergrid_completed_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Name        = var.powergrid_completed_queue_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "shelter_transporting_dlq" {
  name = var.shelter_transporting_dlq_name

  tags = {
    Name        = var.shelter_transporting_dlq_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "shelter_transporting" {
  name                       = var.shelter_transporting_queue_name
  visibility_timeout_seconds = 30
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.shelter_transporting_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Name        = var.shelter_transporting_queue_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "request_completed_dlq" {
  name = var.request_completed_dlq_name

  tags = {
    Name        = var.request_completed_dlq_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "request_completed" {
  name                       = var.request_completed_queue_name
  visibility_timeout_seconds = 30
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.request_completed_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Name        = var.request_completed_queue_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "incident_completed_dlq" {
  name = var.incident_completed_dlq_name

  tags = {
    Name        = var.incident_completed_dlq_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "incident_completed" {
  name                       = var.incident_completed_queue_name
  visibility_timeout_seconds = 30
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.incident_completed_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Name        = var.incident_completed_queue_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_security_group" "ec2_app" {
  name        = "${local.name_prefix}-ec2-sg"
  description = "Security group for Resource Allocation EC2 host"
  vpc_id      = data.aws_vpc.default.id

  dynamic "ingress" {
    for_each = var.ssh_ingress_cidr_blocks
    content {
      description = "SSH access"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  dynamic "ingress" {
    for_each = var.app_ingress_cidr_blocks
    content {
      description = "App access"
      from_port   = var.app_port
      to_port     = var.app_port
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name_prefix}-ec2-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_security_group_rule" "allow_ec2_to_rds" {
  type                     = "ingress"
  from_port                = local.db_port
  to_port                  = local.db_port
  protocol                 = "tcp"
  security_group_id        = local.db_security_group_id
  source_security_group_id = aws_security_group.ec2_app.id
  description              = "Allow Resource Allocation EC2 host to reach PostgreSQL RDS"
}

resource "aws_key_pair" "ec2_app" {
  key_name   = var.ec2_key_pair_name
  public_key = file(pathexpand(var.public_key_path))

  tags = {
    Name        = var.ec2_key_pair_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_instance" "app" {
  ami                         = data.aws_ami.amazon_linux_2023.id
  instance_type               = var.ec2_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  availability_zone           = var.preferred_availability_zone
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.ec2_app.id]
  iam_instance_profile        = var.existing_instance_profile_name
  key_name                    = aws_key_pair.ec2_app.key_name

  user_data = templatefile("${path.module}/templates/ec2-user-data.sh.tftpl", {
    aws_region                              = var.aws_region
    app_port                                = var.app_port
    db_host                                 = local.db_host
    db_port                                 = local.db_port
    db_name                                 = local.db_name
    db_user                                 = local.db_username
    db_password                             = local.db_password
    dynamodb_table_name                     = aws_dynamodb_table.idempotency.name
    sqs_powergrid_completed_url             = aws_sqs_queue.powergrid_completed.url
    sqs_shelter_transporting_url            = aws_sqs_queue.shelter_transporting.url
    sqs_user_location_request_completed_url = aws_sqs_queue.request_completed.url
    sqs_incident_reporter_completed_url     = aws_sqs_queue.incident_completed.url
    image_uri                               = local.container_image_uri
  })

  tags = {
    Name        = "${local.name_prefix}-ec2"
    Project     = var.project_name
    Environment = var.environment
  }

  depends_on = [
    aws_db_instance.app,
    aws_security_group_rule.allow_ec2_to_rds
  ]
}

resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name        = "${local.name_prefix}-eip"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
