# Zone rule sets (CLOUDFLARE.md → Security rules, Rate limiting, Cache rules).
#
# A ruleset is one whole list per phase: Terraform owns every rule in it,
# in this order. A rule added in the dashboard is removed by the next apply.
#
# `ref` is each rule's stable name. Keep it when editing a rule; a new ref
# means Cloudflare deletes the rule and makes a new one.

# --- WAF custom rules (free plan: 5) --------------------------------------

resource "cloudflare_ruleset" "waf_custom" {
  zone_id = var.cloudflare_zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  rules = [
    # GitHub's deploy call is a script, not a browser; a challenge would fail
    # every deploy. Dokploy's API key and Access still guard it (ADR-045, 050).
    {
      ref         = "733eb5f5d1ea44c69b7ab0c4ba860a64"
      description = "deploy API - no challenges"
      expression  = "(http.host eq \"deploy.echoandaura.com\" and starts_with(http.request.uri.path, \"/api/\"))"
      action      = "skip"
      action_parameters = {
        ruleset  = "current"
        products = ["bic", "securityLevel", "uaBlock"]
      }
      logging = {
        enabled = true
      }
      enabled = true
    },
    # Bots probing for WordPress, PHP and leaked files. The app has none of
    # these; refusing them at the edge keeps them off the server.
    {
      ref         = "3dfc9dc6aa034558bbbdbb0e07b9ecfe"
      description = "block scanners"
      expression  = "(http.host eq \"echoandaura.com\" and (starts_with(http.request.uri.path, \"/wp-\") or ends_with(http.request.uri.path, \".php\") or starts_with(http.request.uri.path, \"/.env\") or starts_with(http.request.uri.path, \"/.git\")))"
      action      = "block"
      enabled     = true
    },
    # OFF. Switch on only during a flood from abroad (RUNBOOK → The site is
    # under attack): set enabled = true, apply; false again afterwards.
    {
      ref         = "4a6e74087b3c48c1ba897be4b0b221f8"
      description = "emergency - outside Bangladesh"
      expression  = "(http.host eq \"echoandaura.com\" and ip.src.country ne \"BD\" and not starts_with(http.request.uri.path, \"/_next/\"))"
      action      = "managed_challenge"
      enabled     = false
    },
  ]

  lifecycle {
    prevent_destroy = true
  }
}

# --- Rate limiting (ADR-047; free plan: 1 rule, 10 s windows) -------------

# One address flooding the site would take the server's in-flight budget
# (SERVER.md § 21) from everyone else. 150 / 10 s sits well above one
# person, since many buyers share an address on mobile networks (CGNAT).
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = var.cloudflare_zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [
    {
      ref         = "447e5eb3e18943dda0ad2894e1ee2a2f"
      description = "requests per address"
      # Static docs run on Pages, not the VPS this rule protects. Exclude
      # only this exact host; keep all other hosts and the existing budget.
      expression = "(http.host ne \"docs.echoandaura.com\" and not starts_with(http.request.uri.path, \"/_next/\"))"
      action     = "block"
      ratelimit = {
        characteristics     = ["ip.src", "cf.colo.id"]
        period              = 10
        requests_per_period = 150
        mitigation_timeout  = 10
      }
      enabled = true
    },
  ]

  lifecycle {
    prevent_destroy = true
  }
}

# --- Cache rules (ADR-056) -------------------------------------------------

# Public pages from the edge for 30 s, anonymous visitors only. A path goes
# in the list only if it renders the same for everyone and sets no cookie.
# Never /register, /orders, /tickets, /account, /admin, /door or /api.
resource "cloudflare_ruleset" "cache" {
  zone_id = var.cloudflare_zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_request_cache_settings"

  rules = [
    {
      ref         = "a902ea223bb7454385e0c9f4cf2d54c6"
      description = "public pages for anonymous visitors"
      expression  = "(http.host eq \"echoandaura.com\" and not http.cookie contains \"better-auth\" and (http.request.uri.path in {\"/\" \"/events\" \"/archive\" \"/about\" \"/faq\" \"/terms\" \"/privacy\" \"/refund\" \"/contact\"} or (starts_with(http.request.uri.path, \"/events/\") and not ends_with(http.request.uri.path, \"/register\"))))"
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode    = "override_origin"
          default = 30
          # An error page is never kept.
          status_code_ttl = [
            {
              status_code_range = {
                from = 500
                to   = 526
              }
              value = 0
            },
          ]
        }
        # Browsers still get the origin's no-store.
        browser_ttl = {
          mode = "respect_origin"
        }
      }
      enabled = true
    },
  ]

  lifecycle {
    prevent_destroy = true
  }
}

# --- Redirect rules ------------------------------------------------------

# One address for the site: www.echoandaura.com/<path> → echoandaura.com/<path>,
# permanently (301), query string kept. SITE_URL and canonical URLs name
# the bare domain. The www CNAME (dns.tf) must stay proxied, or this rule
# never sees the request.
resource "cloudflare_ruleset" "redirect" {
  zone_id = var.cloudflare_zone_id
  name    = "default"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [
    {
      ref         = "1285be0cf6e547c7ab541a8dd1a79b2d"
      description = "Redirect from WWW to root"
      expression  = "(http.host eq \"www.echoandaura.com\")"
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code           = 301
          preserve_query_string = true
          target_url = {
            expression = "concat(\"https://echoandaura.com\", http.request.uri.path)"
          }
        }
      }
      enabled = true
    },
  ]

  lifecycle {
    prevent_destroy = true
  }
}
