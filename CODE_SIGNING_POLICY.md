# Code Signing Policy

## v1.0.0 decision

Minimalist Translation v1.0.0 is distributed as an **unsigned Windows Release Candidate**. The current installer has no Authenticode signer or timestamp, the release environment has no available code-signing certificate, and the build configuration does not contain signing credentials.

Windows may therefore display “Unknown publisher” or a Microsoft Defender SmartScreen warning. This warning is expected for this release and must not be presented as proof that a downloaded file is authentic.

## Required verification

Only use the installer named:

`Minimalist-Translation-Setup-1.0.0.exe`

Expected file size: `132,594,735` bytes  
Expected SHA-256: `172BB855628555C4CBA06682C4AF4EA23987027E2BC5781000DD64E20475B9CA`

Verify it in PowerShell before running:

```powershell
Get-FileHash -Algorithm SHA256 .\Minimalist-Translation-Setup-1.0.0.exe
Get-AuthenticodeSignature .\Minimalist-Translation-Setup-1.0.0.exe
```

The first command must return the expected SHA-256. The second command is expected to return `NotSigned` for v1.0.0. Do not install the file if its hash differs.

The companion third-party license archive is:

`Minimalist-Translation-1.0.0-Third-Party-Licenses.zip`

Expected SHA-256: `A731996A644CBE549C66A707107836D1A61361EF50548E3C2F6A9CB432BBD89A`

## Credential boundary

No certificate, private key, password, token or signing-service credential may be committed to Git, included in a release asset, or printed in CI logs. A future signed release must use an externally controlled secret store, a trusted timestamp service and a documented Authenticode verification step.

Changing from unsigned to signed distribution is a release-governance change. It does not alter the project's Source Available non-commercial license or grant commercial-use rights.
