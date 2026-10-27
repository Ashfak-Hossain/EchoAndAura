# The weekly drift check (ADR-089, .github/workflows/drift.yml). It signs in
# without a stored key: GitHub's OIDC token for one job is swapped for this
# role's credentials, which last 15 minutes. Nothing to rotate, nothing to leak.

locals {
  github_repo  = "Ashfak-Hossain/echoandaura"
  state_bucket = "echoandaura-terraform-state"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only a job in the `drift` environment of this repository may take the
# role, and GitHub lets only `main` use that environment (TERRAFORM.md →
# Drift check). A pull request, a fork or another workflow gets a different
# `sub` and is refused.
resource "aws_iam_role" "drift_check" {
  name                 = "echoandaura-drift-check"
  description          = "Weekly terraform plan from GitHub Actions; read-only (ADR-089)"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${local.github_repo}:environment:drift"
        }
      }
    }]
  })
}

# AWS's own read-only policy, so a new kind of resource in the code doesn't
# break the check. It reads configuration everywhere, which a plan needs.
resource "aws_iam_role_policy_attachment" "drift_check_read_only" {
  role       = aws_iam_role.drift_check.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess also reads data: S3 objects (the off-site backups hold every
# buyer's name, email and phone), secret and parameter values, logs, and SES's
# suppression list (the address of every buyer whose mail bounced). A plan
# needs none of it, only the state file. A Deny wins over any Allow.
# Listing a bucket still shows object names, sizes and times: metadata only.
resource "aws_iam_role_policy" "drift_check_no_data" {
  name = "no-data-reads"
  role = aws_iam_role.drift_check.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid         = "OnlyTheStateFiles"
        Effect      = "Deny"
        Action      = "s3:GetObject*"
        NotResource = "arn:aws:s3:::${local.state_bucket}/*"
      },
      {
        Sid    = "NoStoredValues"
        Effect = "Deny"
        Action = [
          "secretsmanager:GetSecretValue",
          "ssm:GetParameter*",
          "kms:Decrypt",
          "logs:Get*",
          "logs:FilterLogEvents",
          "logs:StartQuery",
          "logs:StartLiveTail",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:PartiQL*",
          "sqs:ReceiveMessage",
          "kinesis:GetRecords",
          "athena:GetQueryResults",
          "glacier:GetJobOutput",
          "ec2:GetConsoleOutput",
          "cloudtrail:LookupEvents",
          # Suppression and VDM are not in Terraform (ses.tf), so a plan
          # never reads these.
          "ses:ListSuppressedDestinations",
          "ses:GetSuppressedDestination",
          "ses:GetMessageInsights",
          "ses:ListContacts",
          "ses:GetContact",
          "ses:GetEmailTemplate",
        ]
        Resource = "*"
      },
    ]
  })
}
