# Minimalist Translation v1.0.0

Minimalist Translation v1.0.0 is a Windows local-first, Source Available translation client. This release includes ordinary PDF translation, academic-paper PDF translation and unified user-managed OpenAI-compatible Provider settings.

Desktop Float Ball remains experimental and is not included in the v1.0.0 installer or stable support scope. The hosted Proxy is maintained separately and is not required by this client release.

## Windows download verification

The v1.0.0 installer is intentionally **unsigned**. Windows may display “Unknown publisher” or a Microsoft Defender SmartScreen warning.

- Installer: `Minimalist-Translation-Setup-1.0.0.exe`
- Size: `132,594,735` bytes
- SHA-256: `172BB855628555C4CBA06682C4AF4EA23987027E2BC5781000DD64E20475B9CA`
- Expected Authenticode status: `NotSigned`

Verify before running:

```powershell
Get-FileHash -Algorithm SHA256 .\Minimalist-Translation-Setup-1.0.0.exe
Get-AuthenticodeSignature .\Minimalist-Translation-Setup-1.0.0.exe
```

Do not install the file if its SHA-256 differs. See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) for the complete policy.

## Third-party licenses

- Archive: `Minimalist-Translation-1.0.0-Third-Party-Licenses.zip`
- SHA-256: `A731996A644CBE549C66A707107836D1A61361EF50548E3C2F6A9CB432BBD89A`

The archive is derived from the actual packaged ASAR and Electron runtime. It contains the binary component inventory, package evidence, Electron/Chromium notices and per-file checksums.

## License

Minimalist Translation is distributed under the [Minimalist Translation Source Available Non-Commercial License 1.0](LICENSE). It permits specified non-commercial uses and is not an OSI-approved open-source license. Commercial use requires prior written authorization. Third-party components remain governed by their own licenses.

## Release status

The formal `v1.0.0` tag and GitHub Release were published on 2026-08-28. A full-history audit found no real credential exposure, and the public repository uses a clean root history containing only the approved release scope. All v1.0.0 release gates are closed.
