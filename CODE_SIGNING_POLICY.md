# Code Signing Policy

## v1.1.0 decision

v1.1.0 will continue the **unsigned Windows distribution** model at the user's explicit direction on 2026-10-01. The installer will not carry an Authenticode publisher signature or trusted timestamp. Windows may identify its publisher as **Unknown publisher** and Microsoft Defender SmartScreen may warn or block a first run. Such prompts do not by themselves prove that the file is malicious, and an unsigned file must not be represented as verified merely because it downloaded from a familiar site.

Use only the installer linked from the project's official GitHub Release. Before running it, compare its SHA-256 with the hash published for that exact v1.1.0 asset and inspect its Authenticode status in PowerShell:

```powershell
$releaseInstaller = '.\PATH_TO_DOWNLOADED_INSTALLER.exe' # Replace with the downloaded release asset path.
Get-FileHash -Algorithm SHA256 $releaseInstaller
Get-AuthenticodeSignature $releaseInstaller
```

The expected Authenticode result is `NotSigned`. The published installer is `Minimalist-Translation-Setup-1.1.0.exe`, 132,604,003 bytes, SHA-256 `4C373847B26BD11656EDD3B9D352C078FF2767AE4882FD9243BFD0880BB54304`. If the downloaded file's hash differs from the official release hash, do not run it. A matching hash verifies equality to the published asset, not the identity of a code-signing publisher. Do not bypass an unexpected security warning without checking the official source and hash.

The published asset and checksum are recorded in the [v1.1.0 GitHub Release](https://github.com/Mo-521/Minimalist-Translation/releases/tag/v1.1.0).

## v1.0.0 decision

Minimalist Translation v1.0.0 is distributed as an **unsigned Windows release**. The installer has no Authenticode signer or timestamp, the release environment has no available code-signing certificate, and the build configuration does not contain signing credentials.

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
