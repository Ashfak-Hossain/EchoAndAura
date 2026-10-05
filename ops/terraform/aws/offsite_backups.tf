# Off-site copy of the Postgres backups (ADR-051): survives the loss of the
# Cloudflare account or a compromised server. Dokploy uploads a nightly dump
# (03:30 Dhaka). Was CloudFormation (ops/aws/offsite-backups.yaml) until
# 2026-10-06; moved here by retaining every resource and deleting the stack.
#
# Never public: it holds buyer names, emails and phone numbers.

locals {
  offsite_bucket = "echoandaura-offsite-backups"

  # Days a backup (and any overwritten version) is kept before S3 deletes it.
  offsite_retention_days = 35
}

resource "aws_s3_bucket" "offsite_backups" {
  bucket = local.offsite_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "offsite_backups" {
  bucket                  = aws_s3_bucket.offsite_backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "offsite_backups" {
  bucket = aws_s3_bucket.offsite_backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "offsite_backups" {
  bucket = aws_s3_bucket.offsite_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
    # S3's default for new buckets since 2026: refuse customer-provided keys.
    blocked_encryption_types = ["SSE-C"]
  }
}

# Versioning keeps the original if a stolen key overwrites a file.
resource "aws_s3_bucket_versioning" "offsite_backups" {
  bucket = aws_s3_bucket.offsite_backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Expiry is lifecycle, not Dokploy's keep-latest, which would need delete
# rights the upload key must never have.
resource "aws_s3_bucket_lifecycle_configuration" "offsite_backups" {
  bucket = aws_s3_bucket.offsite_backups.id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {
      prefix = ""
    }
    expiration {
      days = local.offsite_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = local.offsite_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "remove-expired-delete-markers"
    status = "Enabled"
    filter {
      prefix = ""
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
}

resource "aws_s3_bucket_policy" "offsite_backups" {
  bucket = aws_s3_bucket.offsite_backups.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.offsite_backups.arn, "${aws_s3_bucket.offsite_backups.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# The only credential Dokploy holds for this bucket. Its key is made by hand
# (Bitwarden `AWS offsite backups key (Dokploy)`), never here.
resource "aws_iam_user" "offsite_dokploy" {
  name = "${local.offsite_bucket}-dokploy"

  lifecycle {
    ignore_changes  = [tags, tags_all]
    prevent_destroy = true
  }
}

# Never gains a delete or bucket-config action: that is what makes the copy
# off-site in practice. Read is allowed because rclone HEADs each upload to
# check it, and Dokploy offers no --s3-no-head (ADR-051).
resource "aws_iam_user_policy" "offsite_dokploy_upload_only" {
  name = "upload-only"
  user = aws_iam_user.offsite_dokploy.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Dokploy's "Test connection" lists the bucket.
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.offsite_backups.arn
      },
      {
        # rclone rcat streams the dump; larger ones go up in parts.
        Sid    = "Upload"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ]
        Resource = "${aws_s3_bucket.offsite_backups.arn}/*"
      },
      {
        # Explicit, so a broader policy attached later can't undo it.
        Sid    = "NeverDeleteOrReconfigure"
        Effect = "Deny"
        Action = [
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:DeleteBucket",
          "s3:PutBucketVersioning",
          "s3:PutLifecycleConfiguration",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
          "s3:PutObjectRetention",
          "s3:BypassGovernanceRetention",
        ]
        Resource = [aws_s3_bucket.offsite_backups.arn, "${aws_s3_bucket.offsite_backups.arn}/*"]
      },
    ]
  })
}
