# ADR-062. Everything here is pinned exactly; upgrade on purpose, in its own PR.
terraform {
  required_version = "1.15.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.67.0"
    }
  }

  # Terraform's notebook of what it manages. The bucket is made by
  # CloudFormation (ops/aws/terraform-state.yaml), since Terraform can't
  # create the bucket its own state lives in. use_lockfile stops two
  # applies running at once, with no DynamoDB table.
  backend "s3" {
    bucket       = "echoandaura-terraform-state"
    key          = "aws/terraform.tfstate"
    region       = "ap-south-1"
    profile      = "echoandaura"
    encrypt      = true
    use_lockfile = true
  }
}
