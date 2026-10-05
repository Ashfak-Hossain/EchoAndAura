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
