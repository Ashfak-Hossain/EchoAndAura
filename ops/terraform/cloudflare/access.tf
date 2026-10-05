# Cloudflare Access (ADR-050): an email check in front of the admin area
# and the Dokploy dashboard. Behind it, the admin still signs in with
# password + 2FA (ADR-049), Dokploy with its own login + 2FA.
#
# The emails come from .env (variables.tf); they are marked sensitive, so
# a plan prints "(sensitive value)" instead of them.
#
# Not here, on purpose: the `github-deploy` service token itself (creating
# it returns a secret, ADR-062) and the One-time PIN login method.

locals {
  # Settings → Authentication → One-time PIN: Cloudflare emails a code.
  one_time_pin_idp = "d50a5502-b2c3-41d4-a143-79f55bf58c4f"

  # Access → Service auth → `github-deploy` (made by hand; its secret is in
  # GitHub's repo secrets and Bitwarden `Cloudflare Access`).
  github_deploy_service_token_id = "062f0854-e85b-46f5-9da0-4983a7d563b8"
}

# --- Who: reusable policies ------------------------------------------------
# connection_rules.rdp = {}: Cloudflare adds this empty block to every
# policy itself (we use no remote desktop). Without it here, every plan
# would want to remove it.

resource "cloudflare_zero_trust_access_policy" "admins" {
  account_id       = var.cloudflare_account_id
  name             = "admins"
  decision         = "allow"
  include          = [for e in var.access_admin_emails : { email = { email = e } }]
  session_duration = "168h"
  connection_rules = { rdp = {} }
}

resource "cloudflare_zero_trust_access_policy" "developer" {
  account_id       = var.cloudflare_account_id
  name             = "developer"
  decision         = "allow"
  include          = [for e in var.access_developer_emails : { email = { email = e } }]
  session_duration = "168h"
  connection_rules = { rdp = {} }
}

# GitHub's Deploy workflow calls Dokploy's API. A script can't type an
# emailed code, so it shows the service token instead (non_identity).
resource "cloudflare_zero_trust_access_policy" "github_deploy" {
  account_id = var.cloudflare_account_id
  name       = "github deploy"
  decision   = "non_identity"
  include = [
    { service_token = { token_id = local.github_deploy_service_token_id } },
  ]
  connection_rules = { rdp = {} }
}

# --- Where: the two gates ------------------------------------------------

# Everything under /admin. The web also checks the Access token itself
# (CF_ACCESS_AUD, src/lib/cf-access.ts), so the gate can't be walked around
# through Cloudflare's shared addresses. Not /door, the public site or /api.
resource "cloudflare_zero_trust_access_application" "admin" {
  account_id = var.cloudflare_account_id
  name       = "Admin"
  type       = "self_hosted"
  domain     = "echoandaura.com/admin"
  destinations = [
    { type = "public", uri = "echoandaura.com/admin" },
  ]
  policies = [
    { id = cloudflare_zero_trust_access_policy.admins.id, precedence = 1 },
  ]
  session_duration           = "168h"
  allowed_idps               = [local.one_time_pin_idp]
  auto_redirect_to_identity  = true
  app_launcher_visible       = true
  enable_binding_cookie      = false
  http_only_cookie_attribute = false
  options_preflight_bypass   = false

  # Deleting it would open /admin to the internet (password + 2FA only),
  # and a new app gets a new AUD tag: the web would refuse every admin.
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "dokploy" {
  account_id = var.cloudflare_account_id
  name       = "Dokploy"
  type       = "self_hosted"
  domain     = "deploy.echoandaura.com"
  destinations = [
    { type = "public", uri = "deploy.echoandaura.com" },
  ]
  policies = [
    { id = cloudflare_zero_trust_access_policy.developer.id, precedence = 1 },
    { id = cloudflare_zero_trust_access_policy.github_deploy.id, precedence = 2 },
  ]
  session_duration           = "168h"
  allowed_idps               = [local.one_time_pin_idp]
  auto_redirect_to_identity  = true
  app_launcher_visible       = true
  enable_binding_cookie      = false
  http_only_cookie_attribute = false
  options_preflight_bypass   = false

  lifecycle {
    prevent_destroy = true
  }
}
