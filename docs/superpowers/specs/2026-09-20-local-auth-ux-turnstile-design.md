# Local Auth UX and Turnstile Design

## Goal

Make login, registration, password recovery, password reset, and random-code login complete and testable locally, with Cloudflare Turnstile shown only where the server actually enforces it.

## Scope

The audited journeys are:

- Password login
- Account registration and email-confirmation handoff
- Random-code request, resend, edit-email, and verification
- Forgot-password request
- Reset-link validation and password reset
- Anonymous confirmation-email resend after an unverified-login response

Each journey must cover empty and invalid input, submission/loading behavior, API success, API failure, navigation back to login, Enter-key submission, and narrow mobile layout.

## Turnstile Contract

Turnstile protects anonymous operations that create durable state or send email:

- Registration
- Random-code sending and resending
- Forgot-password requests
- Anonymous confirmation-email resend

Password login does not show or require Turnstile because the server protects it with credentials and rate limits. Reset confirmation does not show or require Turnstile because the signed, single-use reset token is its authorization. This removes the current false-security mismatch where those two screens require a browser token that their server endpoints ignore.

The browser obtains `{enabled, siteKey}` from `/api/config`. When disabled, no empty widget shell appears. When enabled, the relevant screen mounts one widget, blocks submission until it has a token, sends the token unchanged, and resets it after each submission. Script, network, site-key, and hostname failures must provide an actionable message instead of referring to a missing checkbox.

Local browser verification uses Cloudflare's official test keys or a deterministic simulated widget. Production secrets remain Vercel-only and never enter source, browser responses, screenshots, or logs.

## Local Runtime

The local development server will serve static assets and dispatch `/api/*` through the same `api/handler.js` used by Vercel. Environment variables choose memory storage, console mail, and Turnstile test configuration. The runtime must preserve request bodies, cookies, headers, status codes, and the `__path` routing contract.

This gives browser tests one origin and avoids CORS differences that do not exist in production.

## UX Behavior

Forms remain within the existing compact account surface. Every transition keeps a clear primary action, local inline feedback, and a visible route back to password login. Buttons are disabled while requests are pending to prevent duplicate emails or registrations. On completion, focus moves to the next meaningful input or result; errors remain adjacent to the action that produced them.

Mobile verification checks 320px and 390px widths for horizontal overflow, clipped Turnstile widgets, occluded messages, stable button dimensions, and visible navigation. Desktop verification checks the same journeys at 1280px.

## Testing

Behavior tests first reproduce each discovered mismatch. Existing jsdom coverage remains the fast regression layer. Browser automation then exercises the integrated local server at desktop and mobile widths, captures screenshots of each major state, checks console and request failures, and verifies that Turnstile tokens appear only on protected requests.

Acceptance requires focused auth tests, API tests, Turnstile tests, reset tests, and browser journey checks to pass. Unrelated existing repository failures are reported separately rather than changed.