#!/usr/bin/env bash
# PreToolUse guard for Bash (ADR-072). Exit 2 = refuse the command and tell
# Claude why. Exit 0 = let it through (to the normal permission rules).
#
# The rules every session follows, whoever runs it:
#   - Production is read-only for Claude. The owner types every change on
#     the server; Claude prepares the command and checks the result.
#   - Tags, releases and merges are the owner's.
#   - Nothing outward-facing (repo settings, secrets, workflow runs,
#     infrastructure applies, deploys, image pushes) runs from a session.
#
# .claude/settings.json denies the same commands; this is the backstop,
# because permission patterns match a command's start and miss
# `cd x && …`, `ssh host '…'` and other compound commands. Matching is on
# the text. It can be fooled on purpose; it exists to stop mistakes.
# Tests: tests/unit/claude-hooks.test.ts.
set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null || true)
[ -z "$cmd" ] && exit 0

refuse() {
  echo "BLOCKED by .claude/hooks/guard-bash.sh: $1" >&2
  echo "$2" >&2
  exit 2
}

# Anywhere in the command (used inside `ssh host '…'`, where the command
# position cannot be known).
has() { printf '%s' "$cmd" | grep -Eq -- "$1"; }
has_i() { printf '%s' "$cmd" | grep -Eiq -- "$1"; }

# Where a command starts: line start, after ; & | ( ` $( or --, after
# sudo/xargs/env/then/do, after VAR=value, through npx or pnpm exec/dlx.
# So `grep "gh release create" file` runs; `cd x && gh release create` does not.
AT='(^|[;&|({`]|\$\(|--|[[:space:]](then|do|else|sudo|xargs|time|command|exec|nohup|env)[[:space:]])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*((npx|pnpm[[:space:]]+(exec|dlx))[[:space:]]+)?'
runs() { printf '%s' "$cmd" | grep -Eq -- "$AT$1"; }
runs_i() { printf '%s' "$cmd" | grep -Eiq -- "$AT$1"; }

E='([^[:alnum:]_-]|$)' # the end of a word
OWNER='Give the owner the exact command to type instead, then check the result read-only (CLAUDE.md, ADR-072).'

# --- Production: read-only ------------------------------------------------
# Any command that reaches the server over ssh (the `echoandaura` alias or
# its address). Reads stay allowed: SELECTs, counts, ls, df, free, mount,
# swapon --show, docker ps/inspect/logs, health checks, pg_restore --list,
# pg_dump to stdout.
if has '(^|[^[:alnum:]_-])ssh[[:space:]]' && has_i 'echoandaura|160\.25\.226\.166'; then
  has 'restore-drill\.sh' &&
    refuse 'the restore drill on the server.' 'The owner runs `pnpm backup:drill` (ADR-088); `pnpm backup:drill-lab` tests it locally.'
  has_i "(insert[[:space:]]+into|update[[:space:]]+[[:alnum:]_.\"]+[[:space:]]+set[[:space:]]|delete[[:space:]]+from|(^|[^[:alnum:]_])truncate$E|drop[[:space:]]+(table|database|schema|index|role|user|view|type|extension|owned)|alter[[:space:]]+(table|role|user|database|schema|type|default)|(^|[^[:alnum:]_])(grant|revoke|vacuum|reindex|cluster)[[:space:]]|create[[:space:]]+(table|role|user|database|schema|index|extension|type|view|function|trigger)|copy[[:space:]].*[[:space:]]from[[:space:]])" &&
    refuse 'SQL that writes to the production database.' "$OWNER"
  if has "(^|[^[:alnum:]_])pg_restore$E" && ! has "pg_restore[[:space:]]+(-l|--list)$E"; then
    refuse 'pg_restore into a production database.' "$OWNER"
  fi
  has '(^|[^[:alnum:]_.-])(rm|mv|shred|dd|truncate|chmod|chown|chattr|ln|install|tee)[[:space:]]' &&
    refuse 'a command that changes files on the server.' "$OWNER"
  has '>{1,2}[[:space:]]*/(root|etc|var|opt|home|srv|usr|tmp)/' &&
    refuse 'a redirect that writes a file on the server.' "$OWNER"
  has_i "docker[[:space:]]+(container[[:space:]]+)?(rm|rmi|stop|kill|restart|pause|unpause|update|rename|commit|cp|prune)$E" &&
    refuse 'a docker command that changes containers.' "$OWNER"
  has_i "docker[[:space:]]+(compose|stack|service|volume|network|image|system|builder|swarm|node|secret|config)[[:space:]]+([^|;&]*[[:space:]])?(up|down|rm|restart|stop|start|kill|scale|update|rollback|prune|create|deploy|leave|init|join)$E" &&
    refuse 'a docker command that changes services, volumes or images.' "$OWNER"
  has_i '\.(clean|obliterate|drain|remove|retryJobs|promoteJobs|removeJobScheduler|upsertJobScheduler|add|addBulk)\(' &&
    refuse 'a BullMQ call that changes the production queues.' "$OWNER"
  has_i "redis-cli([^|;&]*[[:space:]])(del|unlink|flushall|flushdb|set|setex|mset|hset|hdel|zadd|zrem|zremrangebyscore|lpush|rpush|lpop|rpop|lrem|ltrim|sadd|srem|expire|persist|rename|restore|migrate|move|config[[:space:]]+set|shutdown|debug|bgsave|save)$E" &&
    refuse 'a redis-cli command that writes.' "$OWNER"
  has_i "(^|[^[:alnum:]_-])(systemctl|service)[[:space:]]+([^|;&]*[[:space:]])?(start|stop|restart|reload|disable|enable|mask|unmask|kill|daemon-reload)$E" &&
    refuse 'a service change on the server.' "$OWNER"
  has_i "(^|[^[:alnum:]_-])(ufw[[:space:]]+(allow|deny|reject|limit|delete|insert|route|enable|disable|reset|reload)|ip6?tables[[:space:]]+-[ADIRFXNPZ]|nft[[:space:]]+(add|delete|flush|insert|replace|create)|apt(-get)?[[:space:]]+(install|remove|purge|upgrade|full-upgrade|dist-upgrade|autoremove)|dpkg[[:space:]]+-[ir]|snap[[:space:]]+(install|remove|refresh)|reboot|shutdown|poweroff|halt|crontab[[:space:]]+-[er]|useradd|userdel|usermod|passwd|sysctl[[:space:]]+-w|kill|killall|pkill|growpart|resize2fs|mkfs|umount|swapoff)$E" &&
    refuse 'a system change on the server.' "$OWNER"
fi

# --- The restore drill: the owner's (ADR-088) ----------------------------
# It streams every buyer's data from S3 into the server, so a session runs
# only the lab, which never leaves the laptop. The ssh inside it is out of
# this hook's sight, hence rules for the command itself, matched anywhere:
# package managers take flags before the script name (`pnpm -s`, `-C .`).
# The script refuses a Claude Code session too; this stops it sooner.
DRILL='The owner runs `pnpm backup:drill` (RUNBOOK → Restore drill); `pnpm backup:drill-lab` tests it locally.'
if has '(^|[^[:alnum:]_-])(pnpm|npm|yarn|bun|corepack)([[:space:]]|$)' &&
  has 'backup:drill([^-[:alnum:]_]|$)'; then
  refuse 'the production restore drill.' "$DRILL"
fi
# The script itself, run by any runner, unless `--local` follows its name.
if has 'restore-drill(\.[cm]?[jt]s)?([^.[:alnum:]_-]|$)' &&
  has '(^|[^[:alnum:]_.-])(tsx|node|bun|bunx|deno|vite-node|ts-node)([^[:alnum:]_-]|$)|node_modules/\.bin/' &&
  ! has 'restore-drill(\.[cm]?[jt]s)?[[:space:]]+--local([[:space:]]|$)'; then
  refuse 'the production restore drill.' "$DRILL"
fi

# --- Releases: the owner's ------------------------------------------------
# `git tag` may only list or inspect tags.
tags=$(printf '%s' "$cmd" | grep -Eo -- "${AT}git[[:space:]]+tag([[:space:]][^|;&]*)?" | sed -E 's/^.*git[[:space:]]+tag[[:space:]]*//' || true)
if printf '%s' "$cmd" | grep -Eq -- "${AT}git[[:space:]]+tag"; then
  while IFS= read -r args; do
    [ -z "$args" ] && continue
    if printf '%s' "$args" | grep -Eq -- '(^|[[:space:]])(-a|-s|-u|-d|-f|-m|-F|--annotate|--sign|--delete|--force|--message|--file)([[:space:]=]|$)' ||
      ! printf '%s' "$args" | grep -Eq -- '(^|[[:space:]])(-l|--list|--contains|--no-contains|--points-at|--merged|--no-merged|-n[0-9]*|--column|--sort=[^[:space:]]+|--format=[^[:space:]]+|-v|--verify)([[:space:]]|$)'; then
      refuse 'creating, moving or deleting a git tag.' "Tags are the owner's: give them the \`git tag\` and \`git push origin <tag>\` commands (docs/DEVELOPMENT.md → Releases)."
    fi
  done <<EOF
$tags
EOF
fi
runs "git[[:space:]]+push([^|;&]*)(--tags|--follow-tags|--delete|--mirror|refs/tags/|:refs/|[[:space:]]-d([[:space:]]|$)|[[:space:]]v[0-9]+\.[0-9]+\.[0-9]+)" &&
  refuse 'pushing or deleting tags or remote refs.' 'The owner pushes; prepare the command for them.'
runs_i 'gh[[:space:]]+release[[:space:]]+(create|edit|delete|delete-asset|upload)' &&
  refuse 'changing a GitHub Release.' 'Releases are published by the Release workflow when the owner pushes a tag.'

# --- Outward-facing actions ------------------------------------------------
runs_i 'gh[[:space:]]+pr[[:space:]]+(merge|close|reopen|ready|review)' &&
  refuse 'merging, closing or reviewing a pull request.' 'The owner merges. Report the PR state and let them act.'
runs_i 'gh[[:space:]]+(repo[[:space:]]+(edit|delete|rename|archive|unarchive|deploy-key)|secret[[:space:]]+(set|delete|remove)|variable[[:space:]]+(set|delete)|workflow[[:space:]]+(run|enable|disable)|run[[:space:]]+(rerun|cancel|delete)|label[[:space:]]+(create|edit|delete|clone)|ruleset[[:space:]]+(create|edit|delete)|cache[[:space:]]+delete)' &&
  refuse 'changing repository settings, secrets or workflow runs.' 'Give the owner the command or the settings page to change.'
if runs 'gh[[:space:]]+api([[:space:]]|$)'; then
  runs_i 'gh[[:space:]]+api[^|;&]*(-X|--method)[[:space:]=]*(POST|PUT|PATCH|DELETE)' &&
    refuse 'a GitHub API call that writes.' 'Only GET calls run from a session; give the owner the command.'
  if runs 'gh[[:space:]]+api[^|;&]*[[:space:]](-f|-F|--field|--raw-field|--input)[[:space:]=]' &&
    ! runs_i 'gh[[:space:]]+api[^|;&]*(-X|--method)[[:space:]=]*GET'; then
    refuse 'a GitHub API call with fields (gh sends those as a POST).' 'Add `-X GET` for a read, or give the owner the command.'
  fi
fi
runs_i "(terraform|tofu)[^|;&]*[[:space:]](apply|destroy|import|taint|untaint|force-unlock|state[[:space:]]+(rm|mv|push|replace-provider))$E" &&
  refuse 'a Terraform change to real infrastructure.' 'Run `plan` only; the owner applies (docs/infra/TERRAFORM.md).'
runs_i "pnpm[[:space:]]+tf:[a-z]+[^|;&]*[[:space:]](apply|destroy|import|taint|untaint|force-unlock|state[[:space:]]+(rm|mv|push))$E" &&
  refuse 'a Terraform change to real infrastructure.' 'Run `plan` only; the owner applies (docs/infra/TERRAFORM.md).'
runs '(pnpm[[:space:]]+ansible|(\./)?ops/ansible/run\.sh)[[:space:]]+apply' &&
  refuse 'an Ansible apply.' 'Run `check` only; the owner applies (docs/infra/ANSIBLE.md).'
if runs 'ansible-playbook[[:space:]]' && ! has 'ansible-playbook[^|;&]*--check'; then
  refuse 'an ansible-playbook run without --check.' 'Run it in check mode; the owner applies (docs/infra/ANSIBLE.md).'
fi
runs_i '(wrangler[[:space:]]+([^|;&]*[[:space:]])?(deploy|publish|delete|rollback|secret[[:space:]]+(put|delete|bulk)|pages[[:space:]]+(deploy|project[[:space:]]+delete))|wrangler[[:space:]]+r2[[:space:]]+(object|bucket)[[:space:]]+(put|delete|create)|pnpm[[:space:]]+relay:deploy)' &&
  refuse 'a Cloudflare deploy or change.' 'Deploys go through CI; give the owner the command for anything else.'
runs_i "(docker[[:space:]]+(image[[:space:]]+)?push$E|docker[[:space:]]+buildx[[:space:]]+imagetools[[:space:]]+create)" &&
  refuse 'pushing or retagging an image in the registry.' 'Images are built and named by the Deploy and Release workflows.'
runs_i 'aws[[:space:]]+([^|;&]*[[:space:]])?[a-z0-9-]+[[:space:]]+(create|delete|put|update|modify|terminate|run|start|stop|attach|detach|associate|disassociate|enable|disable|tag|untag|restore|reboot|invoke|send|publish|set|add|remove|register|deregister|import)-[a-z0-9-]+' &&
  refuse 'an AWS call that changes resources.' 'Read-only AWS calls only; the owner makes changes (docs/infra/AWS.md).'
runs_i "aws[[:space:]]+s3[[:space:]]+(rm|rb|mv|sync|mb)$E" &&
  refuse 'an S3 write.' 'Read-only AWS calls only; the owner makes changes (docs/infra/AWS.md).'
runs_i 'aws[[:space:]]+s3[[:space:]]+cp[^|;&]*[[:space:]]s3://[^[:space:]]+[[:space:]]*($|[|;&])' &&
  refuse 'an upload to S3.' 'Read-only AWS calls only; the owner makes changes (docs/infra/AWS.md).'

exit 0
