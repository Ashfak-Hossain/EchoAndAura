# Shared values. The account id is looked up, never written down: this repo
# is public (AWS.md → Account).
data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = "ap-south-1"
  domain     = "echoandaura.com"
}
