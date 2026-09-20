# Auth Copy, Password Controls, and Code Entry Design

## Goal

Make login, registration, email-code login, email verification, forgot-password, and reset-password screens concise, professional, consistent, and accessible.

## Password Visibility

Every password field has its own icon-only visibility control:

- Password login: current password
- Registration: password and confirmation password
- Password reset: new password and confirmation password

Each control uses the same inline eye / eye-off SVG style already used elsewhere in the project. The SVG is decorative with `aria-hidden="true"`; the button carries the accessible name. Passwords are hidden initially. Each button controls only its adjacent field and updates both `aria-label` and `aria-pressed` when toggled.

The confirmation labels become `确认密码`, with placeholder text `请再次输入相同密码`.

## Wording

User-facing copy follows these rules:

- Prefer one short sentence per message.
- Lead with the outcome or next action.
- Use `验证码` consistently for the six-digit email code.
- Use `验证邮箱` and `验证邮件` consistently instead of mixing confirmation terms.
- Remove conversational references such as `那颗`, `被拦`, and `照旧`.
- Do not expose console transports, environment variables, diagnostic URLs, mail providers, or DNS configuration in normal auth screens.
- Preserve privacy: forgot-password responses do not reveal whether an email is registered.
- Preserve useful security facts, including token expiry, one-time use, and session revocation after password reset.

Detailed operational diagnostics remain available through the existing self-check page rather than inline auth messages.

## Email Code Entry

Keep the existing six visible digit boxes. They remain the only manual email-code input; no ordinary text field is added.

The code entry keeps:

- Numeric input mode
- One-time-code autocomplete hints
- Automatic movement between boxes
- Backspace and arrow-key navigation
- Whole-code paste support
- Per-digit accessible labels

Add a group-level accessible label of `请输入 6 位验证码`. Rename the submit action from `确定` to `验证并登录`. Countdown labels use Chinese units, such as `剩余 9 分 42 秒` and `重新发送（30 秒）`.

A link-based email login is out of scope. Emails continue to contain a six-digit code that users enter in this screen.

## Interaction And Layout

Icon buttons have a stable square target and do not resize password rows when their state changes. Tooltips and accessible labels identify `显示密码` and `隐藏密码`.

Existing pending-state, Turnstile, responsive, and API behavior remain unchanged. Password login and reset confirmation continue without Turnstile; registration, code sending, forgot-password requests, and verification resends remain protected.

## Testing

Update focused account-page tests to cover:

- Visibility controls beside all five password fields
- Eye / eye-off SVG state, `aria-label`, and `aria-pressed`
- Concise replacement wording and removal of operational language
- Six-box code group semantics and revised labels
- Chinese countdown wording

Extend the browser journey test to toggle each password control independently, verify the six-box code interaction, and recheck all auth screens at `1280x800`, `390x844`, and `320x568`.
