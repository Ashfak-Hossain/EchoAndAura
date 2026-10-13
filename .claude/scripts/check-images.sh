#!/usr/bin/env bash
# Checks a commit's production images in GHCR, read-only and anonymous (the
# packages are public, so no credentials are needed).
#
#   check-images.sh <commit>            the sha-<short> images exist
#   check-images.sh <commit> v1.1.0     ...and v1.1.0 names those same images
#
# The Release workflow names a version with `docker buildx imagetools create`
# (ADR-041), which wraps the sha- manifest in a new index: the version has its
# own digest, so the digests are compared through the platform manifests
# each one points to.
# Exit 0 when every check passes, 1 otherwise.
set -uo pipefail

REGISTRY_PATH=ashfak-hossain
IMAGES=(echoandaura-web echoandaura-worker)
ACCEPT='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'

commit=${1:-}
version=${2:-}
if [ -z "$commit" ] || { [ -n "$version" ] && ! [[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; }; then
  echo "usage: check-images.sh <commit> [vX.Y.Z]" >&2
  exit 1
fi
short=$(git rev-parse --short=7 "$commit^{commit}" 2>/dev/null) || {
  echo "unknown commit: $commit (git fetch origin?)" >&2
  exit 1
}

# The platform manifest digests a tag resolves to, sorted, one per line.
# A plain manifest is its own digest; an index lists its manifests.
digests() { # image token tag
  local headers body type
  headers=$(mktemp)
  body=$(curl -fsS -D "$headers" -H "Authorization: Bearer $2" -H "Accept: $ACCEPT" \
    "https://ghcr.io/v2/$REGISTRY_PATH/$1/manifests/$3" 2>/dev/null) || {
    rm -f "$headers"
    return 1
  }
  type=$(printf '%s' "$body" | jq -r '.mediaType // empty')
  if [[ $type == *index* || $type == *manifest.list* ]]; then
    printf '%s' "$body" | jq -r '.manifests[] | select(.platform.os != "unknown") | .digest' | sort
  else
    tr -d '\r' <"$headers" | sed -nE 's/^[Dd]ocker-[Cc]ontent-[Dd]igest:[[:space:]]*//p'
  fi
  rm -f "$headers"
}

status=0
for image in "${IMAGES[@]}"; do
  token=$(curl -fsS "https://ghcr.io/token?scope=repository:$REGISTRY_PATH/$image:pull" | jq -r '.token // empty')
  if [ -z "$token" ]; then
    echo "❌ $image: no anonymous pull token (network, or the package is private)"
    status=1
    continue
  fi
  if ! built=$(digests "$image" "$token" "sha-$short") || [ -z "$built" ]; then
    echo "❌ $image:sha-$short missing (Deploy built no images for it: not deployed yet, or skipped as non-runtime, ADR-067)"
    status=1
    continue
  fi
  echo "✅ $image:sha-$short $(printf '%s' "$built" | head -1 | cut -c1-19)…"
  [ -z "$version" ] && continue
  if ! named=$(digests "$image" "$token" "$version") || [ -z "$named" ]; then
    echo "❌ $image:$version missing (has the Release workflow run?)"
    status=1
  elif [ "$named" = "$built" ]; then
    echo "✅ $image:$version wraps sha-$short"
  else
    echo "❌ $image:$version points at other images than sha-$short"
    status=1
  fi
done
exit $status
