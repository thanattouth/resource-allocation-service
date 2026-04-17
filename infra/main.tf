locals {
  name_prefix         = "${var.project_name}-${var.environment}"
  ecr_repository      = "${local.name_prefix}-app"
  idempotency_ttl_s   = var.idempotency_ttl_hours * 60 * 60
  container_image_uri = "${aws_ecr_repository.app.repository_url}:${var.container_image_tag}"
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

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
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

resource "aws_sqs_queue" "powergrid_eta_dlq" {
  name = var.powergrid_eta_dlq_name

  tags = {
    Name        = var.powergrid_eta_dlq_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "powergrid_eta" {
  name                       = var.powergrid_eta_queue_name
  visibility_timeout_seconds = 30
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.powergrid_eta_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Name        = var.powergrid_eta_queue_name
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

resource "aws_security_group_rule" "allow_ec2_to_existing_rds" {
  type                     = "ingress"
  from_port                = var.existing_rds_port
  to_port                  = var.existing_rds_port
  protocol                 = "tcp"
  security_group_id        = var.existing_rds_security_group_id
  source_security_group_id = aws_security_group.ec2_app.id
  description              = "Allow Resource Allocation EC2 host to reach existing RDS"
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
    aws_region                    = var.aws_region
    app_port                      = var.app_port
    db_host                       = var.existing_rds_host
    db_port                       = var.existing_rds_port
    db_name                       = var.existing_rds_name
    db_user                       = var.existing_rds_username
    db_password                   = var.existing_rds_password
    dynamodb_table_name           = aws_dynamodb_table.idempotency.name
    sqs_powergrid_eta_updated_url = aws_sqs_queue.powergrid_eta.url
    sqs_shelter_transporting_url  = aws_sqs_queue.shelter_transporting.url
    image_uri                     = local.container_image_uri
  })

  tags = {
    Name        = "${local.name_prefix}-ec2"
    Project     = var.project_name
    Environment = var.environment
  }

  depends_on = [
    aws_security_group_rule.allow_ec2_to_existing_rds
  ]
}
