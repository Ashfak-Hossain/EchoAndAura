# ADR-065: Terraform owns the hosting container; CI uploads checked static
# files. No `source` means Direct Upload, not a second build in Cloudflare.
# Never add app credentials or Functions bindings to this project.
resource "cloudflare_pages_project" "docs" {
  account_id        = var.cloudflare_account_id
  name              = "echoandaura-docs"
  production_branch = "main"

  lifecycle {
    prevent_destroy = true
  }
}

# Attach the hostname only after the first checked production upload works
# at the project's pages.dev address. This API does NOT create the CNAME;
# dns.tf owns it explicitly, after this association (provider 5.26.0).
resource "cloudflare_pages_domain" "docs" {
  count        = var.docs_custom_domain_enabled ? 1 : 0
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.docs.name
  name         = "docs.${local.zone}"

  lifecycle {
    prevent_destroy = true
  }
}
