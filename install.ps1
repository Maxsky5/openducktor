$ErrorActionPreference = 'Stop'

try {
    if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) {
        throw 'This installer supports Windows x64 only.'
    }
    $processors = @(Get-CimInstance -ClassName Win32_Processor)
    if ($processors.Count -eq 0 -or @($processors | Where-Object { $_.Architecture -ne 9 }).Count -gt 0) {
        throw 'This installer supports Windows x64 only.'
    }

    $installPath = Join-Path $env:LOCALAPPDATA 'Programs\OpenDucktor'
    $appPath = Join-Path $installPath 'OpenDucktor.exe'
    $markerPath = Join-Path $env:LOCALAPPDATA 'OpenDucktorInstaller\managed.txt'
    $uninstallRoots = @(
        'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    $displayNamePattern = '^OpenDucktor(?: \d+\.\d+\.\d+)?$'
    $installs = @(
        foreach ($root in $uninstallRoots) {
            if (Test-Path -LiteralPath $root) {
                Get-ChildItem -LiteralPath $root | ForEach-Object {
                    $entry = Get-ItemProperty -LiteralPath $_.PSPath
                    if ($entry.DisplayName -match $displayNamePattern) { $entry }
                }
            }
        }
    )
    if ($installs.Count -gt 1) {
        throw 'More than one OpenDucktor installation is registered. Remove the extra installation before using this script.'
    }
    $managed = Test-Path -LiteralPath $markerPath
    if ($installs.Count -eq 1 -and -not $managed) {
        throw 'Another installer manages OpenDucktor. Update it with that installer or remove it before using this script.'
    }
    if ((Test-Path -LiteralPath $installPath) -and -not $managed) {
        throw "An unmanaged install exists at $installPath. Update or remove it before using this script."
    }
    if ($managed -and (-not (Test-Path -LiteralPath $appPath) -or $installs.Count -ne 1)) {
        throw "The managed install at $installPath is incomplete. Repair or remove it before using this script."
    }
    if ($managed -and ($installs[0].PSPath -notlike '*HKEY_CURRENT_USER*' -or $installs[0].DisplayIcon -ine "$appPath,0")) {
        throw 'The managed marker conflicts with another installation. Repair or remove that install before using this script.'
    }
    if (Get-Process -Name OpenDucktor -ErrorAction SilentlyContinue) {
        throw 'Quit OpenDucktor before updating it.'
    }

    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/Maxsky5/openducktor/releases/latest' -Headers @{
        Accept = 'application/vnd.github+json'
        'User-Agent' = 'OpenDucktor-installer'
    }
    if ($release.draft -or $release.prerelease -or $release.tag_name -cnotmatch '^v\d+\.\d+\.\d+$') {
        throw 'The latest GitHub release is not a published stable version.'
    }
    $version = $release.tag_name.Substring(1)
    $name = "OpenDucktor-$version-win-x64.exe"
    $assets = @($release.assets | Where-Object { $_.name -ceq $name })
    if ($assets.Count -ne 1) {
        throw "Expected one release asset named $name, found $($assets.Count)."
    }
    $asset = $assets[0]
    $expectedUrl = "https://github.com/Maxsky5/openducktor/releases/download/$($release.tag_name)/$name"
    if ($asset.state -ne 'uploaded' -or $asset.browser_download_url -cne $expectedUrl) {
        throw "Release asset $name has no valid uploaded file or URL."
    }
    if ($asset.digest -cnotmatch '^sha256:([0-9a-fA-F]{64})$') {
        throw "Release asset $name has no SHA-256 digest."
    }
    $expectedSha = $Matches[1]

    $work = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $work | Out-Null
    $backup = Join-Path $work 'previous-install'
    $registryBackup = Join-Path $work 'previous-uninstall.reg'
    $cachePath = Join-Path $env:LOCALAPPDATA '@openducktorelectron-updater\installer.exe'
    $cacheDir = Split-Path -Parent $cachePath
    $cacheDirExisted = Test-Path -LiteralPath $cacheDir
    $cacheExisted = Test-Path -LiteralPath $cachePath
    $cacheBackup = Join-Path $work 'previous-installer.exe'
    $markerDir = Split-Path -Parent $markerPath
    $markerDirExisted = Test-Path -LiteralPath $markerDir
    $installTried = $false
    $keepWork = $false
    try {
        $installer = Join-Path $work $name
        Invoke-WebRequest -Uri $expectedUrl -OutFile $installer -UseBasicParsing
        $actualSha = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
        if ($actualSha -ine $expectedSha) {
            throw 'The downloaded asset SHA-256 differs from the GitHub release digest. The existing install is unchanged.'
        }

        if ($managed) {
            Copy-Item -LiteralPath $installPath -Destination $backup -Recurse
            $registryKey = $installs[0].PSPath -replace '^Microsoft.PowerShell.Core\\Registry::', ''
            & reg.exe export $registryKey $registryBackup /y | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not save the existing uninstall record.' }
        }
        if ($cacheExisted) {
            Copy-Item -LiteralPath $cachePath -Destination $cacheBackup
        }
        $installTried = $true
        # NSIS needs /D last and the path unquoted, even with spaces.
        $process = Start-Process -FilePath $installer -ArgumentList "/S /D=$installPath" -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "The NSIS installer failed with exit code $($process.ExitCode)."
        }
        if (-not (Test-Path -LiteralPath $appPath)) {
            throw "The NSIS installer did not install $appPath."
        }
        $userInstalls = @(
            Get-ChildItem -LiteralPath $uninstallRoots[0] | ForEach-Object {
                $entry = Get-ItemProperty -LiteralPath $_.PSPath
                if ($entry.DisplayName -ceq "OpenDucktor $version") { $entry }
            }
        )
        if ($userInstalls.Count -ne 1 -or $userInstalls[0].DisplayIcon -ine "$appPath,0") {
            throw "The NSIS installer did not register one current-user OpenDucktor installation at $appPath."
        }
        if (-not $managed) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $markerPath) -Force | Out-Null
            Set-Content -LiteralPath $markerPath -Value 'Installed by install.ps1' -NoNewline
        }
        $installTried = $false
        Write-Host "OpenDucktor is installed at $appPath"
    }
    catch {
        $installError = $_
        if ($installTried) {
            try {
                if (-not $managed) {
                    # NSIS owns the shortcuts and install key from a new install.
                    $uninstaller = Join-Path $installPath 'Uninstall OpenDucktor.exe'
                    if (Test-Path -LiteralPath $uninstaller) {
                        $undo = Start-Process -FilePath $uninstaller -ArgumentList '/currentuser /S' -Wait -PassThru
                        if ($undo.ExitCode -ne 0) { throw "The NSIS uninstaller failed with exit code $($undo.ExitCode)." }
                    }
                }
                if (Test-Path -LiteralPath $installPath) {
                    Remove-Item -LiteralPath $installPath -Recurse -Force
                }
                if ($cacheExisted) {
                    Copy-Item -LiteralPath $cacheBackup -Destination $cachePath -Force
                } elseif (Test-Path -LiteralPath $cachePath) {
                    Remove-Item -LiteralPath $cachePath -Force
                }
                if (-not $cacheDirExisted -and (Test-Path -LiteralPath $cacheDir) -and @(Get-ChildItem -LiteralPath $cacheDir).Count -eq 0) {
                    Remove-Item -LiteralPath $cacheDir -Force
                }
                if (-not $managed -and (Test-Path -LiteralPath $markerPath)) {
                    Remove-Item -LiteralPath $markerPath -Force
                }
                if (-not $markerDirExisted -and (Test-Path -LiteralPath $markerDir) -and @(Get-ChildItem -LiteralPath $markerDir).Count -eq 0) {
                    Remove-Item -LiteralPath $markerDir -Force
                }
                if ($managed) {
                    Copy-Item -LiteralPath $backup -Destination $installPath -Recurse
                    & reg.exe import $registryBackup | Out-Null
                    if ($LASTEXITCODE -ne 0) { throw 'Could not restore the prior uninstall record.' }
                } else {
                    Get-ChildItem -LiteralPath $uninstallRoots[0] | ForEach-Object {
                        $entry = Get-ItemProperty -LiteralPath $_.PSPath
                        if ($entry.DisplayName -ceq "OpenDucktor $version") {
                            Remove-Item -LiteralPath $_.PSPath -Recurse -Force
                        }
                    }
                }
            }
            catch {
                $keepWork = $true
                $checkPath = if ($managed) { $backup } else { $installPath }
                throw "Install failed: $($installError.Exception.Message). Restore failed: $($_.Exception.Message). Check $checkPath."
            }
        }
        throw $installError
    }
    finally {
        if (-not $keepWork) { Remove-Item -LiteralPath $work -Recurse -Force }
    }
}
catch {
    throw "OpenDucktor install: $($_.Exception.Message)"
}
