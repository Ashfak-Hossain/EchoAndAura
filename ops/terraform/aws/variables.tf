# Private, so not in the public repo: set in .env (pnpm tf:aws loads it).
#   TF_VAR_ses_feedback_email=<the developer's Gmail>
variable "ses_feedback_email" {
  description = "Gets SES bounce and complaint notifications (SNS email subscription): the developer."
  type        = string
  sensitive   = true
}
