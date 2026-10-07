# Not secrets, but kept out of the public repo like the AWS account id.
# Set in .env as TF_VAR_cloudflare_account_id and TF_VAR_cloudflare_zone_id.
variable "cloudflare_account_id" {
  description = "Cloudflare account id (dashboard → the account → Overview, right column)."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone id of echoandaura.com (dashboard → the domain → Overview, right column)."
  type        = string
}

# Two-stage publication, not a routine on/off switch. Once enabled, keep it
# true: prevent_destroy deliberately refuses to remove the live hostname.
variable "docs_custom_domain_enabled" {
  description = "Attach the docs hostname after verifying the first Pages production upload."
  type        = bool
  default     = false
}

# Who may pass Cloudflare Access (ADR-050). Real addresses: kept out of the
# public repo, set in .env as JSON lists, e.g.
#   TF_VAR_access_admin_emails='["dev@example.com","raj@example.com"]'
# Order matters only to keep the plan quiet: Cloudflare stores the list as given.
variable "access_admin_emails" {
  description = "May pass the Admin gate (echoandaura.com/admin): the developer and Raj."
  type        = list(string)
  sensitive   = true
}

variable "access_developer_emails" {
  description = "May pass the Dokploy gate (deploy.echoandaura.com): the developer only."
  type        = list(string)
  sensitive   = true
}
