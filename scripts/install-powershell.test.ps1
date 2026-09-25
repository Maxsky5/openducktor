$ErrorActionPreference = 'Stop'
$global:registered = $false
$global:exitCode = 0
$global:arch = 9
$global:payload = [Text.Encoding]::UTF8.GetBytes('verified NSIS fixture')
$root = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $root | Out-Null
$env:LOCALAPPDATA = Join-Path $root 'LocalAppData'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA | Out-Null
$appPath = Join-Path $env:LOCALAPPDATA 'Programs\OpenDucktor\OpenDucktor.exe'
$global:displayIcon = "$appPath,0"
$scriptPath = Join-Path $PSScriptRoot '..\install.ps1'
$name = 'OpenDucktor-0.8.0-win-x64.exe'
$url = "https://github.com/Maxsky5/openducktor/releases/download/v0.8.0/$name"
$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($global:payload)).Replace('-', '').ToLowerInvariant()
$global:release = [pscustomobject]@{
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
        if ($global:registered -and $LiteralPath -like '*HKEY_CURRENT_USER*') {
            [pscustomobject]@{ PSPath = 'Microsoft.PowerShell.Core\Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mock' }
        }
        return
    }
    Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $LiteralPath
}
function Get-ItemProperty {
    param([string]$LiteralPath)
    [pscustomobject]@{ DisplayName = 'OpenDucktor 0.8.0'; DisplayIcon = $global:displayIcon; PSPath = $LiteralPath }
}
function Remove-Item {
    param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
    if ($LiteralPath -like '*Registry::*') {
        $global:registered = $false
        return
    }
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force
}
function Get-Process {
    param([string]$Name)
    return $null
}
function Get-CimInstance {
    param([string]$ClassName)
    [pscustomobject]@{ Architecture = $global:arch }
}
function Invoke-RestMethod { return $global:release }
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    [IO.File]::WriteAllBytes($OutFile, $global:payload)
}
function Start-Process {
    param([string]$FilePath, [string]$ArgumentList, [switch]$Wait, [switch]$PassThru)
    Assert ($ArgumentList -like '/S /D=*') 'NSIS did not receive /S and /D as the final argument.'
    $path = $ArgumentList.Substring(6)
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $path 'OpenDucktor.exe') -Value "fixture exit $global:exitCode"
    $global:registered = $true
    [pscustomobject]@{ ExitCode = $global:exitCode }
}
function reg.exe {
    param([string]$action, [string]$key, [string]$file, [string]$overwrite)
    if ($action -eq 'export') { Set-Content -LiteralPath $file -Value 'registry fixture' }
    $global:LASTEXITCODE = 0
}

try {
    $global:registered = $true
    try { & $scriptPath; throw 'An unmanaged NSIS install was accepted.' } catch {
        Assert ($_.Exception.Message -like '*Another installer manages*') 'The unmanaged install was not reported.'
    }
    Assert (-not (Test-Path -LiteralPath $appPath)) 'The unmanaged install created a script-managed app.'
    $global:registered = $false

    $global:exitCode = 7
    try { & $scriptPath; throw 'A failed first NSIS process was accepted.' } catch {
        Assert ($_.Exception.Message -like '*exit code 7*') 'The first NSIS exit code was not reported.'
    }
    Assert (-not (Test-Path -LiteralPath $appPath)) 'A failed first install left an app.'
    Assert (-not $global:registered) 'A failed first install left an uninstall record.'

    $global:exitCode = 0
    $global:displayIcon = 'C:\Other\OpenDucktor.exe,0'
    try { & $scriptPath; throw 'An NSIS record for another app path was accepted.' } catch {
        Assert ($_.Exception.Message -like '*did not register one current-user*') 'The wrong install path was not reported.'
    }
    Assert (-not (Test-Path -LiteralPath $appPath)) 'A wrong install path left an app.'
    Assert (-not $global:registered) 'A wrong install path left an uninstall record.'
    $global:displayIcon = "$appPath,0"

    & $scriptPath
    Assert (Test-Path -LiteralPath $appPath) 'The first run did not install OpenDucktor.exe.'
    $first = Get-Content -LiteralPath $appPath -Raw

    $global:displayIcon = 'C:\Other\OpenDucktor.exe,0'
    try { & $scriptPath; throw 'A managed marker with another app path was accepted.' } catch {
        Assert ($_.Exception.Message -like '*marker conflicts*') 'The conflicting app path was not reported.'
    }
    Assert ((Get-Content -LiteralPath $appPath -Raw) -eq $first) 'The conflicting app path changed the prior app.'
    $global:displayIcon = "$appPath,0"

    $global:exitCode = 7
    try { & $scriptPath; throw 'A failed NSIS process was accepted.' } catch {
        Assert ($_.Exception.Message -like '*exit code 7*') 'The NSIS exit code was not reported.'
    }
    Assert ((Get-Content -LiteralPath $appPath -Raw) -eq $first) 'The failed update changed the prior app.'

    $global:exitCode = 0
    & $scriptPath
    Assert (Test-Path -LiteralPath $appPath) 'The repeat run did not leave one installed app.'

    $global:release.assets[0].digest = $null
    try { & $scriptPath; throw 'A missing digest was accepted.' } catch {
        Assert ($_.Exception.Message -like '*SHA-256 digest*') 'The missing digest was not reported.'
    }
    Assert (Test-Path -LiteralPath $appPath) 'A missing digest removed the prior app.'

    $global:arch = 12
    try { & $scriptPath; throw 'Windows ARM64 was accepted.' } catch {
        Assert ($_.Exception.Message -like '*Windows x64 only*') 'The unsupported processor was not reported.'
    }
    Assert (Test-Path -LiteralPath $appPath) 'The unsupported processor removed the prior app.'
    Write-Host 'PowerShell installer fixtures passed.'
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
