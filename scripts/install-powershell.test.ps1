$ErrorActionPreference = 'Stop'
$global:fixtureRegistered = $false
$global:fixtureExitCode = 0
$global:fixtureArchitecture = 9
$global:fixturePayload = [Text.Encoding]::UTF8.GetBytes('verified NSIS fixture')
$root = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $root | Out-Null
$env:LOCALAPPDATA = Join-Path $root 'LocalAppData'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA | Out-Null
$scriptPath = if ($env:ODT_TEST_SCRIPT_PATH) { $env:ODT_TEST_SCRIPT_PATH } else { Join-Path $PSScriptRoot '..\install.ps1' }
$name = 'OpenDucktor-0.8.0-win-x64.exe'
$url = "https://github.com/Maxsky5/openducktor/releases/download/v0.8.0/$name"
$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($global:fixturePayload)).Replace('-', '').ToLowerInvariant()
$global:fixtureRelease = [pscustomobject]@{
    tag_name = 'v0.8.0'
    draft = $false
    prerelease = $false
    assets = @([pscustomobject]@{ name = $name; state = 'uploaded'; digest = "sha256:$hash"; browser_download_url = $url })
}

function Assert([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}
function Test-Path {
    param([string]$LiteralPath)
    if ($LiteralPath -like 'Registry::*') { return $true }
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath
}
function Get-ChildItem {
    param([string]$LiteralPath)
    if ($LiteralPath -like 'Registry::*') {
        if ($global:fixtureRegistered -and $LiteralPath -like '*HKEY_CURRENT_USER*') {
            [pscustomobject]@{ PSPath = 'Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mock' }
        }
        return
    }
    Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $LiteralPath
}
function Get-ItemProperty {
    param([string]$LiteralPath)
    [pscustomobject]@{ DisplayName = 'OpenDucktor'; PSPath = $LiteralPath }
}
function Get-Process {
    param([string]$Name)
    return $null
}
function Get-CimInstance {
    param([string]$ClassName)
    [pscustomobject]@{ Architecture = $global:fixtureArchitecture }
}
function Invoke-RestMethod { return $global:fixtureRelease }
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    [IO.File]::WriteAllBytes($OutFile, $global:fixturePayload)
}
function Start-Process {
    param([string]$FilePath, [string]$ArgumentList, [switch]$Wait, [switch]$PassThru)
    Assert ($ArgumentList -like '/S /D=*') 'NSIS did not receive /S and /D as the final argument.'
    $path = $ArgumentList.Substring(6)
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $path 'OpenDucktor.exe') -Value "fixture exit $global:fixtureExitCode"
    $global:fixtureRegistered = $true
    [pscustomobject]@{ ExitCode = $global:fixtureExitCode }
}
function reg.exe {
    param([string]$action, [string]$key, [string]$file, [string]$overwrite)
    if ($action -eq 'export') { Set-Content -LiteralPath $file -Value 'registry fixture' }
    $global:LASTEXITCODE = 0
}

try {
    & $scriptPath
    $appPath = Join-Path $env:LOCALAPPDATA 'Programs\OpenDucktor\OpenDucktor.exe'
    Assert (Test-Path -LiteralPath $appPath) 'The first run did not install OpenDucktor.exe.'
    $first = Get-Content -LiteralPath $appPath -Raw

    $global:fixtureExitCode = 7
    try { & $scriptPath; throw 'A failed NSIS process was accepted.' } catch {
        Assert ($_.Exception.Message -like '*exit code 7*') 'The NSIS exit code was not reported.'
    }
    Assert ((Get-Content -LiteralPath $appPath -Raw) -eq $first) 'The failed update changed the prior app.'

    $global:fixtureExitCode = 0
    & $scriptPath
    Assert (Test-Path -LiteralPath $appPath) 'The repeat run did not leave one installed app.'

    $global:fixtureRelease.assets[0].digest = $null
    try { & $scriptPath; throw 'A missing digest was accepted.' } catch {
        Assert ($_.Exception.Message -like '*SHA-256 digest*') 'The missing digest was not reported.'
    }
    Assert (Test-Path -LiteralPath $appPath) 'A missing digest removed the prior app.'

    $global:fixtureArchitecture = 12
    try { & $scriptPath; throw 'Windows ARM64 was accepted.' } catch {
        Assert ($_.Exception.Message -like '*Windows x64 only*') 'The unsupported processor was not reported.'
    }
    Assert (Test-Path -LiteralPath $appPath) 'The unsupported processor removed the prior app.'
    Write-Host 'PowerShell installer fixtures passed.'
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
