$ErrorActionPreference = "Stop"

$tempDir = Join-Path $env:TEMP "remote1-setup"
if (!(Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

$moonlightPaths = @(
    "C:\Program Files\Moonlight Game Streaming\Moonlight.exe",
    "C:\Program Files (x86)\Moonlight Game Streaming\Moonlight.exe",
    (Join-Path $env:LOCALAPPDATA "Moonlight Game Streaming\Moonlight.exe")
)

$moonlightInstalled = $false
foreach ($p in $moonlightPaths) {
    if (Test-Path $p) { $moonlightInstalled = $true; break }
}

if (-not $moonlightInstalled) {
    Write-Output "MSG:Moonlight downloading..."

    $moonlightInstaller = Join-Path $tempDir "MoonlightSetup.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $apiUrl = "https://api.github.com/repos/moonlight-stream/moonlight-qt/releases/latest"
        $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing
        $asset = $release.assets | Where-Object { $_.name -match "MoonlightSetup.*\.exe$" } | Select-Object -First 1
        if (-not $asset) {
            Write-Output "ERROR:Moonlight installer not found in release"
            exit 1
        }
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $moonlightInstaller -UseBasicParsing
    } catch {
        Write-Output "ERROR:Moonlight download failed"
        exit 1
    }

    Write-Output "MSG:Moonlight installing..."

    try {
        # Try uninstall first in case of leftover install (error 1638)
        Start-Process -FilePath $moonlightInstaller -ArgumentList "/S /uninstall" -Verb RunAs -Wait -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        # Install fresh
        $proc = Start-Process -FilePath $moonlightInstaller -ArgumentList "/S" -Verb RunAs -PassThru -Wait
        if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 1638) {
            Write-Output "ERROR:Moonlight install failed (code: $($proc.ExitCode))"
            exit 1
        }
    } catch {
        Write-Output "ERROR:Moonlight install failed - admin required"
        exit 1
    }

    Write-Output "MSG:Moonlight installed"
} else {
    Write-Output "MSG:Moonlight OK"
}

try { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}

Write-Output "DONE"
