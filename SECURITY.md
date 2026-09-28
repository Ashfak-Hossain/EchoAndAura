# Security policy

echoandaura is the ticketing site at https://echoandaura.com. It holds
buyers' names, emails and phone numbers, and it is where payments are
verified, so we take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Use one of these instead:

- **GitHub:** the repository's **Security** tab → **Report a vulnerability**,
  which opens a private advisory only the maintainers can see; or
- **Email:** hello@echoandaura.com, with "Security" in the subject.

Please include what you found, how to reproduce it, and what an attacker
could do with it. Test only against your own account and your own orders:
never read, change or delete other people's data, and never degrade the
site for others.

We will acknowledge your report within **3 days** and tell you what we
will do about it. Fixes go out as soon as they are ready. There is no bug
bounty, but we are glad to credit you when the fix ships if you would like.

## Scope

In scope: https://echoandaura.com and this repository's code.

Out of scope: missing security headers without a demonstrated impact,
volumetric denial of service, rate-limit findings without an account
takeover or data exposure, and anything in third-party services (Cloudflare,
AWS, GitHub) — please report those to their owners.
