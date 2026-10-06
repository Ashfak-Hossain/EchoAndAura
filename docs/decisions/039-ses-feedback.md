---
id: ADR-039
title: 'SES feedback: SNS on the identity, not a configuration set; VDM and Auto Validation off'
date: 2026-09-28
status: accepted
area: Tickets and email
supersedes: []
extends: []
---

# ADR-039 — SES feedback: SNS on the identity, not a configuration set; VDM and Auto Validation off

**Date:** 2026-09-28 · **Status:** Accepted

**Context:** SES production access was denied on 2026-09-21. One likely
reason: the request said bounce and complaint notifications "will be
added". Before reopening it, SES has to tell someone about every bounce
and complaint. The account also still had two billed features the setup
wizard had switched on: Virtual Deliverability Manager and Auto Validation.

**Decision:**

- **Notifications on the identity.** `echoandaura.com` sends Bounce and
  Complaint notifications (with the original headers) to a Standard SNS
  topic `ses-feedback` in `ap-south-1`. The topic has one email
  subscription, the developer's Gmail. Delivery notifications stay off,
  and email feedback forwarding is off because SNS carries both kinds.
- **Not a configuration set with an event destination.** We run without
  configuration sets on purpose (AWS.md): the worker policy is
  `identity/*` only, and a missing default set once broke every send.
  Identity notifications need neither, so the worker's policy and the
  mailer stay as they are.
- **The topic policy is scoped.** It has one statement:
  `ses.amazonaws.com` may publish only when `AWS:SourceAccount` is ours
  and `AWS:SourceArn` is the domain identity. Without those conditions,
  any SES identity in any account could publish to the topic.
- **No KMS on the topic.** The AWS-managed SNS key cannot grant SES
  access, and a customer-managed key (~$1/month) would trip the
  zero-spend budget. The message is emailed in plain text anyway.
- **VDM off, Auto Validation off.** Both are billed per message. Auto
  Validation also silently drops mail to addresses SES scores as risky.
  For a ticket email the buyer is waiting on, silence is the worst
  outcome, and without a configuration set nothing would tell us. The
  account-level suppression list (BOUNCE + COMPLAINT) stays on.

**Consequences:**

- A bounce reaches the developer as a raw JSON email within about a
  minute. What to do with each kind is in AWS.md, § Bounce and complaint
  notifications. The app does not consume these notifications: an
  order's email status still only knows "SES accepted it".
- If the topic or its policy breaks, SES switches forwarding back on by
  itself. `pnpm infra:check` checks all three settings and fails if
  forwarding is back on, VDM or Auto Validation is on, or the topic has
  no confirmed subscriber.
- Cost: $0 at this volume. The first 1,000 SNS email notifications each
  month are free.

**Revisit when:** bounces become frequent enough that someone reads
JSON emails daily. At that point, subscribe an HTTPS endpoint or an SQS
queue and let the app mark the order's email as bounced.
