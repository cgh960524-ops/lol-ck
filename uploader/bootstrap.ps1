$ErrorActionPreference = "Stop"
try {
    $env:EUNGCK_UPLOADER_ROOT = $PSScriptRoot
    $mainPath = Join-Path $PSScriptRoot ([char]0xC751 + [char]0x0043 + [char]0x004B + [char]0xC5C5 + [char]0xB85C + [char]0xB354 + ".ps1")
    $source = Get-Content -LiteralPath $mainPath -Raw -Encoding UTF8
    & ([scriptblock]::Create($source))
}
catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "EungCK Uploader Error", "OK", "Error") | Out-Null
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
