<#
  embed-parsec.ps1
  Parsec 창을 Electron 창에 자식 창으로 임베드합니다.
  Outputs: SUCCESS | ERROR:<reason>
#>
param(
  [Parameter(Mandatory)][string]$parentHwnd,
  [int]$x      = 260,
  [int]$y      = 40,
  [int]$width  = 700,
  [int]$height = 620
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinAPI {
    public const int GWL_STYLE   = -16;
    public const int WS_CAPTION    = 0x00C00000;
    public const int WS_THICKFRAME = 0x00040000;
    public const int WS_BORDER     = 0x00800000;
    public const int WS_CHILD      = 0x40000000;
    public const int SW_SHOW       = 5;

    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
    [DllImport("user32.dll")] public static extern int    GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern int    SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] public static extern bool   MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool   ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool   SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool   UpdateWindow(IntPtr hWnd);
}
"@ -ErrorAction SilentlyContinue

# ── Wait for Parsec window (up to 30 seconds) ────────────────────────────────
$parsecHwnd = [IntPtr]::Zero
$deadline   = (Get-Date).AddSeconds(30)

while ((Get-Date) -lt $deadline) {
    $procs = Get-Process -Name "parsecd" -ErrorAction SilentlyContinue |
             Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
    if ($procs) {
        $parsecHwnd = $procs[0].MainWindowHandle
        break
    }
    Start-Sleep -Milliseconds 500
}

if ($parsecHwnd -eq [IntPtr]::Zero) {
    Write-Output "ERROR: Parsec window not found after 30s"
    exit 1
}

# ── Convert parent HWND string → IntPtr ──────────────────────────────────────
try {
    $parentPtr = [IntPtr]::new([long]$parentHwnd)
} catch {
    Write-Output "ERROR: Invalid parentHwnd value: $parentHwnd"
    exit 1
}

# ── Remove Parsec window decorations ─────────────────────────────────────────
$style    = [WinAPI]::GetWindowLong($parsecHwnd, [WinAPI]::GWL_STYLE)
$newStyle = ($style -band (-bnot [WinAPI]::WS_CAPTION) `
                    -band (-bnot [WinAPI]::WS_THICKFRAME) `
                    -band (-bnot [WinAPI]::WS_BORDER)) `
            -bor [WinAPI]::WS_CHILD
[WinAPI]::SetWindowLong($parsecHwnd, [WinAPI]::GWL_STYLE, $newStyle) | Out-Null

# ── Reparent into Electron window ────────────────────────────────────────────
[WinAPI]::SetParent($parsecHwnd, $parentPtr) | Out-Null

# ── Position & show ──────────────────────────────────────────────────────────
[WinAPI]::MoveWindow($parsecHwnd, $x, $y, $width, $height, $true) | Out-Null
[WinAPI]::ShowWindow($parsecHwnd, [WinAPI]::SW_SHOW)  | Out-Null
[WinAPI]::UpdateWindow($parsecHwnd)                   | Out-Null

Write-Output "SUCCESS"
