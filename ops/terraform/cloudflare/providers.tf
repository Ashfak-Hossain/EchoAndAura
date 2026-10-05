# The API token comes from CLOUDFLARE_API_TOKEN in .env (`pnpm tf:cloudflare`
# loads it). Never put it in a .tf file: this repo is public.
provider "cloudflare" {}
