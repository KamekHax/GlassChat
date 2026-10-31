# GlassChat 1.0.1 — Beta source candidate (unpublished)

**Source build ID:** `20261031.2`
**Semantic version:** `1.0.1`
**Status:** Development/source candidate only. This is not a published GitHub Release.

## Current source

- The Electron application and separately deployable GlassChat-owned authentication/chat service are in the repository source.
- The service uses PostgreSQL migrations, Argon2id password hashing, one-use email tokens, revocable sessions and membership-checked Commons/#general text chat.
- A Gmail API mail adapter and static verification/reset page source exist, but OAuth credentials, actual email delivery, Neon connection/migrations and Render deployment are not configured.
- The operator accepted centrally stored, application-readable channel messages only for a clearly disclosed limited Beta. This build is not local-first and does not provide end-to-end encryption.
- The website source has five legal working drafts and account-action pages; legal drafts are not reviewed and do not imply a deployed account service.

## Verification completed

- Repository regression suite: 7 tests passed, 0 failed in the latest run after the Gmail mailer and CORS changes.
- Static website build/check: 15 routes and 372 local links/assets passed; no stable or beta installer release was available, and no fake download was emitted.
- Package manifests and the service lockfile report semantic version `1.0.1`; the current app source build identifier is `20261031.2`.

## Release blockers

- No matching Windows installer has been built from source build `20261031.2`.
- Existing 1.0.1 Windows candidates use build ID `20261031.1`; they are unsigned, not native-Windows verified, and not included as public release assets.
- Native Windows install, first launch, shortcuts, upgrade, user-data preservation, downgrade protection and uninstall remain unverified.
- Google Gmail API OAuth and live account-verification/password-reset delivery are not configured; Neon is not connected; the Render Free prototype has not been created.
- The legal pages are drafts, not final or legally reviewed.

Do not attach installer files to a GitHub Release or treat this note as an announcement until the matching build has passed the applicable Windows, backend, security and release checks. The official site only exposes assets attached to a real published GitHub Release.
