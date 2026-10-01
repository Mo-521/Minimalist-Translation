# Security Policy

Minimalist Translation handles user documents, translated text, and user-supplied Provider credentials. Security reports are welcome and should be handled without exposing credentials, private documents, or exploit details publicly.

## Supported versions

Security fixes target the latest published stable release, currently v1.1.0. v1.0.x is an older snapshot. Desktop Float Ball is excluded from the v1.0.0 and v1.1.0 installers and binary assets and is not covered by a stability commitment. Security issues in retained experimental source remain reportable when they could affect contributors or a future distribution.

| Version | Support status |
|---|---|
| Latest published stable release (currently v1.1.0) | Security reports accepted; receives security fixes |
| v1.0.x and older snapshots | Not supported |
| `main` after the latest release | Security reports accepted; development branch |
| Generated artifacts and private forks | Not supported |
| Independent `lingoflow-proxy` repository | Report to that repository; outside this client repository's scope |

## Reporting a vulnerability

Do not publish vulnerability details, working exploits, API keys, private PDFs, translated content, logs containing credentials, or local configuration files in a public Issue.

Preferred reporting path:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** to create a private security advisory.
3. Include the affected version or commit, affected component, reproduction conditions, security impact, and a minimal sanitized proof of concept.

Target repository: <https://github.com/Mo-521/Minimalist-Translation>

If private vulnerability reporting is not yet enabled, create a minimal public Issue stating only that you need a private security contact. Do not include technical details or sensitive material. The maintainer must establish a private channel before requesting the report contents.

## What to include

- Affected version, commit, platform, and installation method.
- Affected surface, such as Provider configuration, Electron IPC, PDF parsing/rendering/export, local files, Desktop selection capture, dependency packaging, or release artifacts.
- Required attacker access and user interaction.
- Reproduction steps using synthetic or fully sanitized data.
- Expected and observed security impact.
- Suggested mitigation, if known.

Replace secrets with obvious placeholders. Reduce documents to the smallest synthetic fixture that still demonstrates the issue. Remove user names, paths, document titles, Provider responses, tokens, cookies, and account identifiers.

## In-scope security reports

- Exposure or unintended persistence of API keys, tokens, credentials, private documents, or translated content.
- Unsafe file writes, path traversal, arbitrary file access, or unsafe export behavior.
- Remote code execution, command injection, unsafe Electron IPC, or privilege-boundary bypass.
- Malicious PDF behavior that escapes intended parsing/rendering boundaries or causes a security impact beyond an ordinary parsing failure.
- Dependency, packaging, update, or release-integrity issues affecting distributed artifacts.
- Network requests or telemetry that contradict the documented local-first data boundary.
- Security issues in the experimental Desktop source when they affect code shipped by this repository.

## Usually out of scope

- Provider outages, latency, pricing, model quality, or upstream content-policy decisions.
- Translation accuracy or ordinary PDF layout defects without a security impact.
- Findings that require publishing real credentials or private documents to demonstrate.
- Vulnerabilities only in an independently maintained Proxy deployment; report those to its own repository.
- Automated scanner output without an affected path, reproducible condition, or security impact.
- Social engineering, denial-of-service traffic against third-party Providers, and physical access to an already-unlocked device unless a project-specific boundary is bypassed.

## Handling and disclosure

The maintainer will acknowledge a usable private report when practical, validate scope and impact, and coordinate remediation and disclosure based on severity and release readiness. No fixed response or remediation deadline is promised.

Reporters should allow reasonable time for investigation and a safe release before public disclosure. The project will not request secrecy beyond what is needed to protect users and complete coordinated remediation. Acknowledgement may be provided with the reporter's consent.

## Credential exposure

If a real credential is discovered in source, Git history, logs, an Issue, a release asset, or a test fixture:

1. Do not copy or test the credential beyond what is necessary to identify the exposure.
2. Notify the maintainer privately.
3. Revoke or rotate the credential at its issuer; deleting the file alone is insufficient.
4. Review Git history, caches, CI logs, release assets, and independent repositories for copies.
5. Do not publish the old value, even after revocation.

## Security boundaries

- Provider credentials are intended to remain in ignored local configuration and must never be committed.
- Text submitted for translation is sent to the Provider selected by the user; the application is not fully offline unless the selected Provider is local.
- Private PDFs, generated Sidecars, diagnostics, logs, and local Agent/governance files are not release assets.
- The project license and [Third-Party Notices](THIRD_PARTY_NOTICES.md) do not provide security warranties.

Security policy changes must remain consistent with [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), the public repository boundary, and the actual release state.
