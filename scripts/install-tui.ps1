$ErrorActionPreference = "Stop"

$Repo = "AlbertTeslaWizard/Mebius-Code"
$Version = if ($env:MEBIUS_CODE_VERSION) { $env:MEBIUS_CODE_VERSION } else { "latest" }
$InstallDir = if ($env:MEBIUS_INSTALL_DIR) { $env:MEBIUS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "MebiusCode\bin" }

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($arch -ne [System.Runtime.InteropServices.Architecture]::X64) {
    throw "Windows $arch binaries are not published yet."
}

$asset = "mebius-windows-x64.zip"
$baseUrl = if ($Version -eq "latest") {
    "https://github.com/$Repo/releases/latest/download"
} elseif ($Version.StartsWith("v")) {
    "https://github.com/$Repo/releases/download/$Version"
} else {
    "https://github.com/$Repo/releases/download/v$Version"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("mebius-code-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
    $archive = Join-Path $tmp $asset
    $sums = Join-Path $tmp "SHA256SUMS"
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$asset" -OutFile $archive
    Invoke-WebRequest -UseBasicParsing "$baseUrl/SHA256SUMS" -OutFile $sums

    $line = Get-Content -LiteralPath $sums | Where-Object { $_.EndsWith("  $asset") } | Select-Object -First 1
    if (-not $line) { throw "No checksum entry found for $asset" }
    $expected = $line.Substring(0, 64).ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset" }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $InstallDir -Force

    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathParts = @($currentUserPath -split ";") | Where-Object { $_ }
    if ($pathParts -notcontains $InstallDir) {
        $nextPath = if ($currentUserPath) { "$currentUserPath;$InstallDir" } else { $InstallDir }
        [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
        $env:Path = "$env:Path;$InstallDir"
        Write-Host "Added $InstallDir to the user PATH. Restart your terminal if 'mebius' is not found."
    }

    $exe = Join-Path $InstallDir "mebius.exe"
    Write-Host "Mebius TUI installed to $exe"
    & $exe doctor
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
