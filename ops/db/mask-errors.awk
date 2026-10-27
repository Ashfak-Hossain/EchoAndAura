# Masks pg_restore's error lines before they leave the server (ADR-088).
# A failed restore's message can quote a value from a row: a name, a phone,
# a trxID. Only a quoted lowercase name right after "constraint", "relation",
# "table", "column" or "index" is kept; from the first other quote on, the
# line is cut and ends in "…". Control characters go too, so a crafted
# backup can't send escapes to the owner's terminal.
#
#   ... | awk -f mask-errors.awk
{
  rest = substr($0, 1, 200)
  gsub(/[[:cntrl:]]/, "", rest)
  # Postgres's "Key (column)=(value)" form, in case it reaches an error line.
  sub(/\)=\(.*/, ")=(…)", rest)
  out = ""
  while ((i = index(rest, "\"")) > 0) {
    before = substr(rest, 1, i - 1)
    after = substr(rest, i + 1)
    j = index(after, "\"")
    name = substr(after, 1, j - 1)
    if (j > 0 && before ~ /(constraint|relation|table|column|index) $/ && name ~ /^[a-z_][a-z0-9_]*$/) {
      out = out before "\"" name "\""
      rest = substr(after, j + 1)
    } else {
      out = out before "\"…\""
      rest = ""
    }
  }
  print out rest
}
