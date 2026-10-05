# IAM for the app (AWS.md → Principals). Not here: root and ash-admin
# (humans), and every access key: creating one returns its secret, which
# must never reach state (ADR-062). Keys are made by hand.

# The worker's identity for SES. One access key (AWS_SES_* in Dokploy).
resource "aws_iam_user" "worker" {
  name = "echoandaura-worker"

  # The console labels each access key with a tag named after its key id.
  # Those come and go with keys made by hand; keep them out of the code.
  lifecycle {
    ignore_changes  = [tags, tags_all]
    prevent_destroy = true
  }
}

# The safety boundary: a leaked key can send mail from our identities and
# do nothing else. identity/* and not the domain: in the sandbox SES checks
# the recipient identity too. No configuration-set/* (we run without).
resource "aws_iam_user_policy" "worker_ses_send_only" {
  name = "ses-send-only"
  user = aws_iam_user.worker.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "arn:aws:ses:${local.region}:${local.account_id}:identity/*"
    }]
  })
}
