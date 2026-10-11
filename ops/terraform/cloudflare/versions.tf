# ADR-062. Everything here is pinned exactly; upgrade on purpose, in its own PR.
terraform {
  required_version = "1.15.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.27.0"
    }
  }

  # Same bucket as ops/terraform/aws, a different file: a Cloudflare apply
  # can never touch AWS state. Reading it needs the AWS login too.
  backend "s3" {
    bucket       = "echoandaura-terraform-state"
    key          = "cloudflare/terraform.tfstate"
    region       = "ap-south-1"
    profile      = "echoandaura"
    encrypt      = true
    use_lockfile = true
  }
}
