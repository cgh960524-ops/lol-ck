[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ConfigPath,

    [ValidateNotNullOrEmpty()]
    [string]$OutputFile,

    [ValidatePattern('^\d+(\.\d+){0,3}$')]
    [string]$Version = "$(Get-Date -Format 'yyyy.M.d').0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $repositoryRoot "uploader\응CK업로더.ps1"
$buildDate = Get-Date -Format "yyyyMMdd"
if ([string]::IsNullOrWhiteSpace($OutputFile)) {
    $OutputFile = Join-Path $repositoryRoot "dist\응CK-업로더-공개-$buildDate\응CK업로더.exe"
}

$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$resolvedSourceFile = (Resolve-Path -LiteralPath $sourceFile).Path
$outputFullPath = [IO.Path]::GetFullPath($OutputFile)
if ([IO.Path]::GetExtension($outputFullPath) -ne ".exe") {
    throw "OutputFile은 .exe 파일이어야 합니다."
}

$config = Get-Content -LiteralPath $resolvedConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$adminUploadToken = [string]$config.uploadToken
if ([string]::IsNullOrWhiteSpace($adminUploadToken)) {
    throw "ConfigPath의 uploadToken이 비어 있습니다."
}

$messageBytes = [Text.Encoding]::UTF8.GetBytes("match-upload-v1")
$keyBytes = [Text.Encoding]::UTF8.GetBytes($adminUploadToken)
$hmac = New-Object Security.Cryptography.HMACSHA256 -ArgumentList (,$keyBytes)
try {
    $scopedTokenBytes = $hmac.ComputeHash($messageBytes)
}
finally {
    $hmac.Dispose()
}
$matchUploadToken = ([BitConverter]::ToString($scopedTokenBytes)).Replace("-", "").ToLowerInvariant()

$sourceText = [IO.File]::ReadAllText($resolvedSourceFile, [Text.Encoding]::UTF8)
$placeholder = "__MATCH_UPLOAD_TOKEN__"
$placeholderCount = ([regex]::Matches($sourceText, [regex]::Escape($placeholder))).Count
if ($placeholderCount -ne 1) {
    throw "공개용 업로더 소스의 토큰 placeholder가 예상과 다릅니다."
}
$compiledSource = $sourceText.Replace($placeholder, $matchUploadToken)

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("eungck-public-uploader-" + [guid]::NewGuid().ToString("N"))
$temporarySource = Join-Path $temporaryDirectory "public-uploader.ps1"
$outputDirectory = Split-Path -Parent $outputFullPath

try {
    [IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
    [IO.File]::WriteAllText($temporarySource, $compiledSource, (New-Object Text.UTF8Encoding($true)))

    $parseTokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($temporarySource, [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) {
        $messages = ($parseErrors | ForEach-Object { $_.Message }) -join "; "
        throw "공개용 업로더 PowerShell 문법 검증에 실패했습니다: $messages"
    }

    Import-Module ps2exe -MinimumVersion 1.0.18 -ErrorAction Stop
    Invoke-ps2exe `
        -inputFile $temporarySource `
        -outputFile $outputFullPath `
        -noConsole `
        -STA `
        -DPIAware `
        -supportOS `
        -title "응CK 업로더" `
        -description "응CK 경기 업로더" `
        -company "응CK 연구소" `
        -product "응CK 업로더" `
        -version $Version

    if (-not (Test-Path -LiteralPath $outputFullPath -PathType Leaf)) {
        throw "업로더 실행 파일이 생성되지 않았습니다."
    }

    $builtFile = Get-Item -LiteralPath $outputFullPath
    Write-Output ("공개용 업로더 빌드 완료: {0} ({1:N0} bytes)" -f $builtFile.FullName, $builtFile.Length)
}
finally {
    $adminUploadToken = $null
    $matchUploadToken = $null
    $compiledSource = $null
    if (Test-Path -LiteralPath $temporarySource) {
        Remove-Item -LiteralPath $temporarySource -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Force -ErrorAction SilentlyContinue
    }
}
