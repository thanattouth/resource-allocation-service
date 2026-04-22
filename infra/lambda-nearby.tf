locals {
  nearby_lambda_name         = "${local.name_prefix}-nearby"
  nearby_lambda_log_group    = "/aws/lambda/${local.nearby_lambda_name}"
  nearby_lambda_handler_path = "app/lambda/nearbyHandler.nearbyHandler"
  nearby_lambda_package_file = abspath("${path.module}/${var.nearby_lambda_package_path}")
}

data "aws_iam_role" "lambda_execution" {
  name = var.lambda_role_name
}

resource "aws_security_group" "lambda_nearby" {
  name        = "${local.name_prefix}-lambda-nearby-sg"
  description = "Security group for nearby Lambda"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name_prefix}-lambda-nearby-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_security_group_rule" "allow_lambda_to_existing_rds" {
  type                     = "ingress"
  from_port                = var.existing_rds_port
  to_port                  = var.existing_rds_port
  protocol                 = "tcp"
  security_group_id        = var.existing_rds_security_group_id
  source_security_group_id = aws_security_group.lambda_nearby.id
  description              = "Allow nearby Lambda to reach existing RDS"
}

resource "aws_cloudwatch_log_group" "nearby_lambda" {
  name              = local.nearby_lambda_log_group
  retention_in_days = var.lambda_log_retention_days

  tags = {
    Name        = local.nearby_lambda_log_group
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "nearby_api" {
  name              = "/aws/apigateway/${local.name_prefix}-nearby-http"
  retention_in_days = var.lambda_log_retention_days

  tags = {
    Name        = "/aws/apigateway/${local.name_prefix}-nearby-http"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_lambda_function" "nearby" {
  function_name    = local.nearby_lambda_name
  description      = "Search nearby resources from PostgreSQL/PostGIS"
  role             = data.aws_iam_role.lambda_execution.arn
  runtime          = "nodejs20.x"
  handler          = local.nearby_lambda_handler_path
  filename         = local.nearby_lambda_package_file
  source_code_hash = filebase64sha256(local.nearby_lambda_package_file)
  timeout          = var.nearby_lambda_timeout_seconds
  memory_size      = var.nearby_lambda_memory_mb

  vpc_config {
    subnet_ids         = data.aws_subnets.default.ids
    security_group_ids = [aws_security_group.lambda_nearby.id]
  }

  environment {
    variables = {
      DB_HOST                 = var.existing_rds_host
      DB_PORT                 = tostring(var.existing_rds_port)
      DB_NAME                 = var.existing_rds_name
      DB_USER                 = var.existing_rds_username
      DB_PASSWORD             = var.existing_rds_password
      DB_SSL                  = var.lambda_db_ssl_enabled ? "true" : "false"
      DB_CONNECT_TIMEOUT      = tostring(var.lambda_db_connect_timeout_ms)
      DB_POOL_MAX             = tostring(var.lambda_db_pool_max)
      DB_QUERY_TIMEOUT_MS     = tostring(var.lambda_db_query_timeout_ms)
      DISPATCHER_BEARER_TOKEN = var.dispatcher_bearer_token
      NODE_ENV                = "production"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.nearby_lambda,
    aws_security_group_rule.allow_lambda_to_existing_rds
  ]
}

resource "aws_apigatewayv2_api" "nearby" {
  name          = "${local.name_prefix}-nearby-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["Authorization", "Content-Type", "x-correlation-id", "x-request-id"]
    allow_methods = ["GET", "OPTIONS"]
    allow_origins = ["*"]
    max_age       = 300
  }

  tags = {
    Name        = "${local.name_prefix}-nearby-http"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_integration" "nearby_lambda" {
  api_id                 = aws_apigatewayv2_api.nearby.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.nearby.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = min(var.nearby_lambda_timeout_seconds * 1000, 30000)
}

resource "aws_apigatewayv2_route" "nearby_get" {
  api_id    = aws_apigatewayv2_api.nearby.id
  route_key = "GET /v1/resources/nearby"
  target    = "integrations/${aws_apigatewayv2_integration.nearby_lambda.id}"
}

resource "aws_apigatewayv2_stage" "nearby_default" {
  api_id      = aws_apigatewayv2_api.nearby.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.nearby_api_throttling_burst_limit
    throttling_rate_limit  = var.nearby_api_throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.nearby_api.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  tags = {
    Name        = "${local.name_prefix}-nearby-http-default"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_lambda_permission" "allow_apigw_nearby" {
  statement_id  = "AllowApiGatewayInvokeNearby"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.nearby.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.nearby.execution_arn}/*/*"
}
