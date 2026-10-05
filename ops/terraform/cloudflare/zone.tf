# Zone-wide settings (CLOUDFLARE.md).

# Must stay off: when on, Cloudflare rewrites addresses in the HTML and
# injects a decoder script. Our CSP blocks the script and React hydration
# fails on every page (#418). It hid nothing anyway.
resource "cloudflare_zone_setting" "email_obfuscation" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "email_obfuscation"
  value      = "off"
}

# Signs our DNS answers so nobody can forge them on the way to a visitor.
# The registrar is Cloudflare, so the DS record is published for us.
# Destroying this resource switches DNSSEC off; hence prevent_destroy.
resource "cloudflare_zone_dnssec" "this" {
  zone_id = var.cloudflare_zone_id
  status  = "active"

  lifecycle {
    prevent_destroy = true
  }
}
