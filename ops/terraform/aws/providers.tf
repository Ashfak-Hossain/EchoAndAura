# Signed in with `aws login --profile echoandaura` as ash-admin. SES
# identities are per region; everything lives in ap-south-1 (AWS.md).
provider "aws" {
  region  = "ap-south-1"
  profile = "echoandaura"
}
