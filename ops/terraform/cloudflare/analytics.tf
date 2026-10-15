# ADR-077: Cloudflare Web Analytics, cookieless visit counts. The app adds
# the beacon itself, with the page's CSP nonce, on the pages it measures
# (src/lib/web-analytics.ts). auto_install must stay false: Cloudflare would
# inject its script into every page, our CSP would block it, and the
# injection reaches the ticket and order pages the app leaves unmeasured.
# Changing this needs Account Settings -> Edit on the token, granted only for
# that apply (TERRAFORM.md -> The Cloudflare token). Destroying it would end
# the history and change the token every page carries.
resource "cloudflare_web_analytics_site" "site" {
  account_id   = var.cloudflare_account_id
  zone_tag     = var.cloudflare_zone_id
  auto_install = false

  lifecycle {
    prevent_destroy = true
  }
}

# Goes into Dokploy as CF_WEB_ANALYTICS_TOKEN. Not a secret: every measured
# page carries it in its HTML.
output "web_analytics_token" {
  description = "Site token for CF_WEB_ANALYTICS_TOKEN (public: it is in the page source)."
  value       = cloudflare_web_analytics_site.site.site_token
}
