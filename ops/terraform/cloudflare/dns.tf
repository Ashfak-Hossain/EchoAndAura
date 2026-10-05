# DNS records for echoandaura.com that we own (CLOUDFLARE.md → DNS).
#
# Not here on purpose: records Cloudflare marks read-only because another
# product owns them. Email Routing (MX @), Email Service (cf-bounce MX/TXT,
# cf-bounce._domainkey, cf2024-1._domainkey), R2's custom domain (media) and
# the relay Worker's custom domain (relay). Change those in their product.
#
# prevent_destroy on every record: a record that disappears is an outage
# (the site) or mail in spam (SES, SPF, DMARC). Renaming a resource here
# would look like delete + create; use a `moved` block instead.
#
# ttl = 1 means "automatic" (Cloudflare's default; required when proxied).

locals {
  zone = "echoandaura.com"
}

# --- The site -----------------------------------------------------------

# Proxied: the origin answers Cloudflare's addresses only (ADR-045).
resource "cloudflare_dns_record" "a_root" {
  zone_id = var.cloudflare_zone_id
  name    = local.zone
  type    = "A"
  content = "160.25.226.166"
  ttl     = 1
  proxied = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "cname_www" {
  zone_id = var.cloudflare_zone_id
  name    = "www.${local.zone}"
  type    = "CNAME"
  content = local.zone
  ttl     = 1
  proxied = true

  lifecycle {
    prevent_destroy = true
  }
}

# The Dokploy dashboard and its API (GitHub's deploy call). Behind
# Cloudflare Access (ADR-050) and a WAF skip rule for /api/*.
resource "cloudflare_dns_record" "a_deploy" {
  zone_id = var.cloudflare_zone_id
  name    = "deploy.${local.zone}"
  type    = "A"
  content = "160.25.226.166"
  ttl     = 1
  proxied = true

  lifecycle {
    prevent_destroy = true
  }
}

# --- SES (outbound mail rollback, ADR-057) ------------------------------
# DNS only: proxying a DKIM CNAME or an MX host breaks it silently.

# Easy DKIM: SES signs as echoandaura.com with keys these publish.
# Losing one = Gmail spam folder within hours.
resource "cloudflare_dns_record" "cname_ses_dkim_1" {
  zone_id = var.cloudflare_zone_id
  name    = "tiqho3f6k6gqjjucwewakfvqyjmiu46q._domainkey.${local.zone}"
  type    = "CNAME"
  content = "tiqho3f6k6gqjjucwewakfvqyjmiu46q.dkim.amazonses.com"
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "cname_ses_dkim_2" {
  zone_id = var.cloudflare_zone_id
  name    = "bjtddvusgm23hci2bzarxllb7py7l7kk._domainkey.${local.zone}"
  type    = "CNAME"
  content = "bjtddvusgm23hci2bzarxllb7py7l7kk.dkim.amazonses.com"
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "cname_ses_dkim_3" {
  zone_id = var.cloudflare_zone_id
  name    = "tsrr3pkudaqmrgu7hdfft4camf656gro._domainkey.${local.zone}"
  type    = "CNAME"
  content = "tsrr3pkudaqmrgu7hdfft4camf656gro.dkim.amazonses.com"
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

# Custom MAIL FROM: bounces return to SES, and SPF aligns on mail.
resource "cloudflare_dns_record" "mx_mail_ses" {
  zone_id  = var.cloudflare_zone_id
  name     = "mail.${local.zone}"
  type     = "MX"
  content  = "feedback-smtp.ap-south-1.amazonses.com"
  priority = 10
  ttl      = 1
  proxied  = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "txt_spf_mail" {
  zone_id = var.cloudflare_zone_id
  name    = "mail.${local.zone}"
  type    = "TXT"
  content = "\"v=spf1 include:amazonses.com ~all\""
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

# --- Domain-wide mail policy ----------------------------------------------

# ONE SPF record on @ only: Cloudflare Email Routing and SES. Merge into
# this one; a second SPF record makes both invalid.
resource "cloudflare_dns_record" "txt_spf_root" {
  zone_id = var.cloudflare_zone_id
  name    = local.zone
  type    = "TXT"
  content = "\"v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all\""
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

# Report only for now; tighten to p=quarantine (CLOUDFLARE.md runbook).
resource "cloudflare_dns_record" "txt_dmarc" {
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.${local.zone}"
  type    = "TXT"
  content = "\"v=DMARC1; p=none; rua=mailto:hello@echoandaura.com\""
  ttl     = 1
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}

# --- Search engines (ADR-042) -------------------------------------------

# Google Search Console's proof of ownership; Bing imported from it.
# Deleting it drops Search Console access.
resource "cloudflare_dns_record" "txt_google_site_verification" {
  zone_id = var.cloudflare_zone_id
  name    = local.zone
  type    = "TXT"
  content = "\"google-site-verification=S3DYisjK96_Pj68G62eYa0CZZ3q8k8pM1_e4FaRmDWU\""
  ttl     = 3600
  proxied = false

  lifecycle {
    prevent_destroy = true
  }
}
