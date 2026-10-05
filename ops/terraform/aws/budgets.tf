# Money safety (AWS.md → Budgets and cost). AWS has no hard spending cap;
# budgets only alert, and one of them acts. The real protection is that
# the keys on the server are narrow (send-only, upload-only) and can't
# create billable resources.
#
# The expected bill is cents. Any alert means something outside AWS.md is
# running: RUNBOOK → AWS.md "A budget alert fired".

locals {
  alert_emails = [var.alerts_developer_email, var.alerts_account_email]
}

# More than pennies (> $0.25) → email. Not > $0.01: with S3 in use, a
# cent or two plus tax can appear any month, and an alarm that rings for
# pennies gets ignored.
resource "aws_budgets_budget" "zero_spend" {
  name         = "Echo And Aura Zero-Spend Budget"
  budget_type  = "COST"
  limit_amount = "1.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  # Newer budgets are tied to the account's primary billing view.
  billing_view_arn = "arn:aws:billing::${local.account_id}:billingview/primary"

  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 0.25
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = local.alert_emails
  }
}

# $5 a month, credits and refunds left out so they can't hide real spend.
# Normal is cents; near $5 deserves a look, and an SES rollback night
# still fits.
resource "aws_budgets_budget" "monthly" {
  name         = "Echo and Aura Monthly Cost Budget"
  budget_type  = "COST"
  limit_amount = "5.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  # Newer budgets are tied to the account's primary billing view.
  billing_view_arn = "arn:aws:billing::${local.account_id}:billingview/primary"
  metrics          = ["UnblendedCost"]

  filter_expression {
    not {
      dimensions {
        key    = "RECORD_TYPE"
        values = ["Credit", "Refund"]
      }
    }
  }

  # 85 % spent: early warning.
  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 85
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = local.alert_emails
  }

  # 100 % spent.
  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = local.alert_emails
  }

  # On course to pass $2 by month end.
  notification {
    notification_type          = "FORECASTED"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = local.alert_emails
  }
}

# $10 actual → the action below locks the worker key. About 100,000 SES
# emails: ~5x any real event, so a busy rollback night never trips it,
# while a stolen key costs at most ~$10 plus the hours budget data lags.
resource "aws_budgets_budget" "hard_stop" {
  name         = "Echo and Aura hard stop budget"
  budget_type  = "COST"
  limit_amount = "10.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = local.alert_emails
  }
}

# At 100 % of the hard stop, AWS attaches AWSDenyAll to the worker user by
# itself (no approval): a stolen send-only key stops costing money. Email
# stops too; Cloudflare Email Service is the primary mailer (ADR-057).
# To undo after the cause is fixed: IAM → echoandaura-worker → detach
# AWSDenyAll (or reset the action in Budgets).
resource "aws_budgets_budget_action" "hard_stop_deny_worker" {
  budget_name        = aws_budgets_budget.hard_stop.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budgets_actions.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = "arn:aws:iam::aws:policy/AWSDenyAll"
      users      = [aws_iam_user.worker.name]
    }
  }

  subscriber {
    subscription_type = "EMAIL"
    address           = var.alerts_developer_email
  }

  subscriber {
    subscription_type = "EMAIL"
    address           = var.alerts_account_email
  }
}

# Budgets assumes this role to attach the deny policy.
resource "aws_iam_role" "budgets_actions" {
  name = "BudgetsActionsRole"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "budgets.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "budgets_actions" {
  role       = aws_iam_role.budgets_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AWSBudgetsActionsWithAWSResourceControlAccess"
}

# --- Cost Anomaly Detection -------------------------------------------
# Watches spend per service and emails a daily digest when an anomaly
# costs >= $100 AND >= 40 % above normal (the console's defaults). At our
# scale the $1 and $2 budgets fire long before this; it is the net for a
# large surprise.
resource "aws_ce_anomaly_monitor" "services" {
  name              = "Default-Services-Monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "services" {
  name             = "Default-Services-Subscription"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]

  subscriber {
    type    = "EMAIL"
    address = var.alerts_account_email
  }

  threshold_expression {
    and {
      dimension {
        key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
        match_options = ["GREATER_THAN_OR_EQUAL"]
        values        = ["100.0"]
      }
    }
    and {
      dimension {
        key           = "ANOMALY_TOTAL_IMPACT_PERCENTAGE"
        match_options = ["GREATER_THAN_OR_EQUAL"]
        values        = ["40.0"]
      }
    }
  }
}
