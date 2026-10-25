# Contributing

echoandaura is public so that its code can be read and learned from. It is
not open source: the [LICENSE](LICENSE) grants no right to copy, reuse or
deploy it. This page says what outside help we can take, and how every
change here is made.

## What we accept

- **Bug reports and feature ideas: yes.** Open an issue from one of the
  templates. Say what you saw, what you expected, and how to repeat it.
- **Security problems: privately.** Never in a public issue.
  [SECURITY.md](SECURITY.md) says how to report one.
- **Pull requests from outside the maintainers: no.** They are closed
  without review. That isn't about the quality of the work: the licence
  means we can't merge code we don't own. If you found a fix, describe it in
  an issue instead.
- **A problem with a ticket or an order?** Contact the organizer at
  [echoandaura.com/contact](https://echoandaura.com/contact). This
  repository is for the code. [SUPPORT.md](SUPPORT.md) says where each kind
  of question goes.

Everyone taking part in issues follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## How a change is made

Every change, from a typo to a new feature, takes the same path. Each step
links to where it is written down in full.

1. **Plan before code.** Describe the change and get it approved before
   writing anything. For a feature, `/slice` lays out the plan layer by
   layer ([.claude/commands/slice.md](.claude/commands/slice.md)).
2. **Build it as a vertical slice**: schema → repository → service → route
   → UI → test. One slice complete and green before the next. Business
   logic lives in `src/server/` and imports no `next/*`
   ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
3. **Keep the invariants.** Money, inventory, orders, fulfilment and the
   order state machine follow the seven rules in [CLAUDE.md](CLAUDE.md).
   Breaking one loses money or corrupts data.
4. **Pass the gate.** `pnpm verify` runs type checks, lint, every test, the
   build and the docs check. If it fails, the change isn't done. The full
   list is the
   [Definition of Done](docs/DEVELOPMENT.md#definition-of-done).
5. **Run the reviewers** whose paths the change touches: code, security,
   migrations, public safety
   ([.claude/README.md → Reviewers](.claude/README.md#reviewers)).
6. **Open a pull request** from the template
   ([.github/pull_request_template.md](.github/pull_request_template.md)):
   a Summary that says what and why, a Test plan that says what was run
   and what it proved, and Risk or Invariants sections only when they
   apply.
7. **Record a choice that isn't obvious** as a short ADR in
   [docs/decisions/](docs/decisions/README.md#adding-an-adr). A routine
   change doesn't need one.

## Branches and commits

- **Branch from a fresh `origin/main`**, without tracking it, so a plain
  `git push` can't land on `main`:

  ```bash
  git fetch origin
  git switch -c docs/what-it-does --no-track origin/main
  ```

- **Name the branch** `type/short-description`, using the commit types
  below: `feat/promo-codes`, `fix/expiry-grace`, `docs/contributing`.
- **One pull request at a time.** No branch built on another open branch.
- **Conventional commits**: `type(scope): what it does`, in the imperative.
  Types used here: `feat`, `fix`, `docs`, `test`, `chore`, `ci`, `build`,
  `refactor`. For example:
  `fix(orders): release the hold when a payment is rejected`.
- **Merge commits only**, no squash or rebase. GitHub deletes the branch
  after the merge.
- **Every merge to `main` deploys** to production. `main` is always
  deployable, and CI must be green to merge.

The details, including releases and dependency updates, are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#branching--commits).

## Never

- Edit files in `drizzle/` by hand. Change the schema and generate the
  migration.
- Commit `.env` or any secret.
- Use `any`. Use `unknown` and narrow it.
- Skip or weaken a test to make CI pass.
- Add a dependency with a `^` range. Versions are pinned exactly.
- Force-push to `main`.

## Working with Claude Code

Most of this code is written with Claude Code. Claude edits, tests and reads
production. The owner commits, merges, tags and changes production
([ADR-072](docs/decisions/072-ai-guardrails.md)). The commands, reviewers
and hooks that enforce this are in [.claude/README.md](.claude/README.md).
