# Amazon SES in ap-south-1: the rollback mailer since ADR-057 (Cloudflare
# Email Service sends). AWS.md → SES. Its DNS records are in
# ../cloudflare/dns.tf.
#
# Not here, on purpose:
# - Account-level settings: suppression list, VDM, Auto Validation. The
#   provider can't express Auto Validation, and its suppression resource
#   writes without it, which could switch Auto Validation back on (it
#   silently drops mail). `pnpm infra:check` guards all three.
# - The two Gmail identities: private addresses, only needed while the
#   account is in the sandbox.
# - Production access: a support case, not a setting.

# Easy DKIM, RSA 2048: SES signs as echoandaura.com with the keys the three
# _domainkey CNAMEs publish. No configuration set: a dangling default
# breaks every send (ADR-039).
resource "aws_sesv2_email_identity" "domain" {
  email_identity = local.domain

  lifecycle {
    prevent_destroy = true
  }
}

# Custom MAIL FROM (mail.echoandaura.com): bounces return to SES and SPF
# aligns with the From domain. Its MX and TXT are in dns.tf.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = "mail.${local.domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# Off: SNS carries bounces and complaints. SES turns this back on by
# itself if a publish fails (topic deleted, policy broken); then a plan
# shows it.
resource "aws_sesv2_email_identity_feedback_attributes" "domain" {
  email_identity           = aws_sesv2_email_identity.domain.email_identity
  email_forwarding_enabled = false
}

# --- Bounce and complaint notifications (ADR-039) ----------------------
# On the identity, not a configuration set. Delivery: none (one email per
# ticket would bury the rest).

resource "aws_ses_identity_notification_topic" "bounce" {
  identity                 = aws_sesv2_email_identity.domain.email_identity
  notification_type        = "Bounce"
  topic_arn                = aws_sns_topic.ses_feedback.arn
  include_original_headers = true
}

resource "aws_ses_identity_notification_topic" "complaint" {
  identity                 = aws_sesv2_email_identity.domain.email_identity
  notification_type        = "Complaint"
  topic_arn                = aws_sns_topic.ses_feedback.arn
  include_original_headers = true
}

# Standard (SES can't publish to FIFO), no encryption: the AWS-managed
# key's policy can't let SES in, and a customer key costs ~$1/month, which
# trips the budgets. The message is emailed in plain text anyway.
resource "aws_sns_topic" "ses_feedback" {
  name = "ses-feedback"
}

# Only SES, only for our account and our domain identity (confused-deputy
# protection).
resource "aws_sns_topic_policy" "ses_feedback" {
  arn = aws_sns_topic.ses_feedback.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSesPublishForEchoandauraDomain"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.ses_feedback.arn
      Condition = {
        StringEquals = {
          "AWS:SourceAccount" = local.account_id
          "AWS:SourceArn"     = aws_sesv2_email_identity.domain.arn
        }
      }
    }]
  })
}

# Raw JSON by email to the developer. A new address must click the
# confirmation link AWS sends before anything arrives.
resource "aws_sns_topic_subscription" "ses_feedback_email" {
  topic_arn = aws_sns_topic.ses_feedback.arn
  protocol  = "email"
  endpoint  = var.ses_feedback_email
}
