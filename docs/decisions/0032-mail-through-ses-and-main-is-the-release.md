# 32. Mail leaves through SES from the task role, Stripe delivers to the distribution, and main is the release

Status: accepted
Date: 2026-09-02

## Context

Production mailed to `localhost:1025` and held placeholder Stripe keys, one day after the
release stopped storing keys.

## Options

- `MAIL_TRANSPORT=ses` over `SESv2Client` from the task role (chosen).
- The SMTP interface of SES: an IAM user and a long-lived key in SSM.
- A third party: a personal account outside AWS in the path of a store on AWS.

## Decision

The SES branch is a dozen lines in one constructor, and `smtp` stays the default for a laptop
and CI. The account has no domain, so the sender is one verified identity and, in the
sandbox, only verified addresses receive. The Stripe endpoint is the distribution's URL,
because the default behaviour forwards the body and `stripe-signature` as sent. Main is the
release since the merge of 2026-09-02.

## Consequences

**Gives up:** the mails land in spam, because SES cannot sign for a personal address. No
bounce handling. `SMTP_PASS` is still read by a task that does not use it.

**Switch:** a third party with an owned domain when AWS refuses production access, or when the
store leaves AWS: the provider's host in SSM and `MAIL_TRANSPORT=smtp`.
