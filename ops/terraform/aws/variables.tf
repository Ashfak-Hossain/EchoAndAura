# Private, so not in the public repo: set in .env (pnpm tf:aws loads it).
#   TF_VAR_ses_feedback_email=<the developer's Gmail>
variable "ses_feedback_email" {
  description = "Gets SES bounce and complaint notifications (SNS email subscription): the developer."
  type        = string
  sensitive   = true
}

# Who hears about money (budgets, the hard stop, cost anomalies).
#   TF_VAR_alerts_developer_email=<the developer's Gmail>
#   TF_VAR_alerts_account_email=<the second address on the alerts>
# Not marked sensitive, on purpose: marking them would make the first apply
# rewrite every live alert (same values) just to relabel them. They are
# still only in .env, never in the repo; a plan may print them locally.
variable "alerts_developer_email" {
  description = "Gets every budget alert: the developer."
  type        = string
}

variable "alerts_account_email" {
  description = "Gets every budget alert and the cost-anomaly digest: the account's second contact."
  type        = string
}
