# tflint for both root modules (ADR-062); CI runs it on every pull request.
# Only the built-in Terraform rules: no provider plugins to download, and
# no credentials needed.
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
