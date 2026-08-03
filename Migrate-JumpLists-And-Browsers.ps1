<#
Author: DJ, 
Department: CTS
Description: This script is designed to backup and restore Windows Jump Lists and browser bookmarks for users migrating to a new laptop. 
It supports two license types (E3 and F3) which determine the backup location (OneDrive for E3, NAS for F3). 
The script should be run in two phases: first the Backup phase on the old laptop, then the Restore phase on the new laptop. 
The script handles closing relevant applications, copying necessary files, and provides feedback throughout the process.
#>

$ErrorActionPreference = "Stop"

# ----------------------------
# Config
# ----------------------------
$NasTempRoot = "\\nas01\sterling\Home\Xfer\Cleared_monthly\Dj\scripts\New-System-Temp-Location"
$ExplorerQuickAccessFile = "1b4dd67f29cb1962.automaticDestinations-ms"

# ----------------------------
# Helpers
# ----------------------------
function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-WarnMsg {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Good {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Ensure-Folder {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Stop-ProcessSafe {
    param([Parameter(Mandatory = $true)][string]$Name)
    Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Get-OneDrivePath {
    if ($env:OneDrive -and (Test-Path -LiteralPath $env:OneDrive)) {
        return $env:OneDrive
    }

    $candidates = @(
        (Join-Path $env:USERPROFILE "OneDrive"),
        (Join-Path $env:USERPROFILE "OneDrive - Signet Jewelers")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "OneDrive path not found. Confirm the user is signed into OneDrive."
}

function Get-BackupRoot {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("E3", "F3")]
        [string]$LicenseType
    )

    switch ($LicenseType) {
        "E3" {
            $oneDrive = Get-OneDrivePath
            return (Join-Path $oneDrive "JumpListsBackup")
        }
        "F3" {
            $userFolder = Join-Path $NasTempRoot $env:USERNAME
            return (Join-Path $userFolder "JumpListsBackup")
        }
    }
}

function Get-ProfileFolders {
    param([Parameter(Mandatory = $true)][string]$UserDataPath)

    if (-not (Test-Path -LiteralPath $UserDataPath)) {
        return @()
    }

    return Get-ChildItem -Path $UserDataPath -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" }
}

function Backup-BookmarksFromBrowser {
    param(
        [Parameter(Mandatory = $true)][string]$BrowserName,
        [Parameter(Mandatory = $true)][string]$UserDataPath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )

    $profiles = Get-ProfileFolders -UserDataPath $UserDataPath
    if (-not $profiles -or $profiles.Count -eq 0) {
        Write-WarnMsg "$BrowserName profile path not found or no profiles present: $UserDataPath"
        return
    }

    foreach ($profile in $profiles) {
        $bookmarks = Join-Path $profile.FullName "Bookmarks"
        $bookmarksBak = Join-Path $profile.FullName "Bookmarks.bak"

        if (Test-Path -LiteralPath $bookmarks) {
            $profileDest = Join-Path $DestinationRoot $profile.Name
            Ensure-Folder -Path $profileDest

            Copy-Item -Path $bookmarks -Destination (Join-Path $profileDest "Bookmarks") -Force
            if (Test-Path -LiteralPath $bookmarksBak) {
                Copy-Item -Path $bookmarksBak -Destination (Join-Path $profileDest "Bookmarks.bak") -Force -ErrorAction SilentlyContinue
            }

            Write-Good "Backed up $BrowserName bookmarks for profile: $($profile.Name)"
        }
    }
}

function Restore-BookmarksToBrowser {
    param(
        [Parameter(Mandatory = $true)][string]$BrowserName,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$UserDataPath
    )

    if (-not (Test-Path -LiteralPath $SourceRoot)) {
        Write-WarnMsg "No $BrowserName bookmark backup found: $SourceRoot"
        return
    }

    Ensure-Folder -Path $UserDataPath

    $profileBackups = Get-ChildItem -Path $SourceRoot -Directory -ErrorAction SilentlyContinue
    foreach ($profileBackup in $profileBackups) {
        $srcBookmarks = Join-Path $profileBackup.FullName "Bookmarks"
        $srcBookmarksBak = Join-Path $profileBackup.FullName "Bookmarks.bak"

        if (-not (Test-Path -LiteralPath $srcBookmarks)) {
            continue
        }

        $destProfile = Join-Path $UserDataPath $profileBackup.Name
        Ensure-Folder -Path $destProfile

        Copy-Item -Path $srcBookmarks -Destination (Join-Path $destProfile "Bookmarks") -Force
        if (Test-Path -LiteralPath $srcBookmarksBak) {
            Copy-Item -Path $srcBookmarksBak -Destination (Join-Path $destProfile "Bookmarks.bak") -Force -ErrorAction SilentlyContinue
        }

        Write-Good "Restored $BrowserName bookmarks for profile: $($profileBackup.Name)"
    }
}

function Backup-MappedDrives {
    param([Parameter(Mandatory = $true)][string]$BackupRoot)

    $mappedDriveFile = Join-Path $BackupRoot "MappedDrives.csv"

    $drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 4" -ErrorAction SilentlyContinue |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_.ProviderName) } |
        Select-Object @{
            Name = "DriveLetter"
            Expression = { $_.DeviceID.TrimEnd(':') }
        }, @{
            Name = "RemotePath"
            Expression = { $_.ProviderName }
        }, @{
            Name = "VolumeName"
            Expression = { $_.VolumeName }
        }

    if ($drives -and ($drives | Measure-Object).Count -gt 0) {
        $drives | Sort-Object DriveLetter | Export-Csv -Path $mappedDriveFile -NoTypeInformation -Encoding UTF8
        Write-Good "Mapped drives backed up to $mappedDriveFile"
    } else {
        Write-WarnMsg "No mapped network drives found to back up."
    }
}

function Restore-MappedDrives {
    param([Parameter(Mandatory = $true)][string]$BackupRoot)

    $mappedDriveFile = Join-Path $BackupRoot "MappedDrives.csv"

    if (-not (Test-Path -LiteralPath $mappedDriveFile)) {
        Write-WarnMsg "No mapped drive backup file found: $mappedDriveFile"
        return
    }

    $driveMappings = Import-Csv -Path $mappedDriveFile

    if (-not $driveMappings -or ($driveMappings | Measure-Object).Count -eq 0) {
        Write-WarnMsg "Mapped drive backup file exists but contains no mappings."
        return
    }

    foreach ($mapping in $driveMappings) {
        $driveLetter = ($mapping.DriveLetter | ForEach-Object { $_.Trim().TrimEnd(':') })
        $remotePath  = ($mapping.RemotePath  | ForEach-Object { $_.Trim() })

        if ([string]::IsNullOrWhiteSpace($driveLetter) -or [string]::IsNullOrWhiteSpace($remotePath)) {
            continue
        }

        $existing = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID = '$driveLetter`:'" -ErrorAction SilentlyContinue

        if ($existing) {
            if ($existing.DriveType -eq 4 -and $existing.ProviderName -eq $remotePath) {
                Write-Good "Mapped drive already exists: $driveLetter`: -> $remotePath"
                continue
            } else {
                Write-WarnMsg "Drive letter $driveLetter`: is already in use. Skipping restore for $remotePath"
                continue
            }
        }

        Write-Info "Restoring mapped drive $driveLetter`: -> $remotePath"
        $output = & cmd.exe /c "net use $driveLetter`: `"$remotePath`" /persistent:yes" 2>&1

        $postCheck = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID = '$driveLetter`:'" -ErrorAction SilentlyContinue
        if ($postCheck -and $postCheck.DriveType -eq 4 -and $postCheck.ProviderName -eq $remotePath) {
            Write-Good "Mapped drive restored: $driveLetter`: -> $remotePath"
        } else {
            Write-WarnMsg "Failed to restore mapped drive: $driveLetter`: -> $remotePath"
            if ($output) {
                Write-WarnMsg ($output | Out-String).Trim()
            }
        }
    }
}

function Write-Manifest {
    param([Parameter(Mandatory = $true)][string]$BackupRoot)

    $autoOut = Join-Path $BackupRoot "AutoDest"
    $custOut = Join-Path $BackupRoot "CustDest"
    $chromeOut = Join-Path $BackupRoot "BrowserBackup\Chrome"
    $edgeOut = Join-Path $BackupRoot "BrowserBackup\Edge"
    $mappedDriveFile = Join-Path $BackupRoot "MappedDrives.csv"
    $manifestPath = Join-Path $BackupRoot "manifest.txt"

    $autoCount = (Get-ChildItem -Path $autoOut -File -ErrorAction SilentlyContinue | Measure-Object).Count
    $custCount = (Get-ChildItem -Path $custOut -File -ErrorAction SilentlyContinue | Measure-Object).Count
    $chromeBmCount = (Get-ChildItem -Path $chromeOut -Recurse -File -Filter "Bookmarks" -ErrorAction SilentlyContinue | Measure-Object).Count
    $edgeBmCount = (Get-ChildItem -Path $edgeOut -Recurse -File -Filter "Bookmarks" -ErrorAction SilentlyContinue | Measure-Object).Count
    $mappedDriveCount = 0

    if (Test-Path -LiteralPath $mappedDriveFile) {
        $mappedDriveCount = (Import-Csv -Path $mappedDriveFile | Measure-Object).Count
    }

    @(
        "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        "User: $env:USERNAME"
        "Computer: $env:COMPUTERNAME"
        "BackupRoot: $BackupRoot"
        "AutoDest Files: $autoCount"
        "CustDest Files: $custCount"
        "Chrome Bookmark Files: $chromeBmCount"
        "Edge Bookmark Files: $edgeBmCount"
        "Mapped Drives: $mappedDriveCount"
    ) | Set-Content -Path $manifestPath -Encoding UTF8
}

# ----------------------------
# Backup
# ----------------------------
function Invoke-Backup {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("E3", "F3")]
        [string]$LicenseType
    )

    $backupRoot = Get-BackupRoot -LicenseType $LicenseType

    $autoSrc = Join-Path $env:APPDATA "Microsoft\Windows\Recent\AutomaticDestinations"
    $custSrc = Join-Path $env:APPDATA "Microsoft\Windows\Recent\CustomDestinations"

    $autoOut   = Join-Path $backupRoot "AutoDest"
    $custOut   = Join-Path $backupRoot "CustDest"
    $chromeOut = Join-Path $backupRoot "BrowserBackup\Chrome"
    $edgeOut   = Join-Path $backupRoot "BrowserBackup\Edge"

    Ensure-Folder -Path $backupRoot
    Ensure-Folder -Path $autoOut
    Ensure-Folder -Path $custOut
    Ensure-Folder -Path $chromeOut
    Ensure-Folder -Path $edgeOut

    Write-Info "Closing Chrome and Edge..."
    Stop-ProcessSafe -Name "chrome"
    Stop-ProcessSafe -Name "msedge"

    if (-not (Test-Path -LiteralPath $autoSrc)) {
        throw "AutomaticDestinations source not found: $autoSrc"
    }

    if (-not (Test-Path -LiteralPath $custSrc)) {
        throw "CustomDestinations source not found: $custSrc"
    }

    Write-Info "Backing up AutomaticDestinations..."
    Copy-Item -Path (Join-Path $autoSrc "*") -Destination $autoOut -Force

    Write-Info "Backing up CustomDestinations..."
    Copy-Item -Path (Join-Path $custSrc "*") -Destination $custOut -Force

    Write-Info "Backing up Chrome bookmarks..."
    Backup-BookmarksFromBrowser `
        -BrowserName "Chrome" `
        -UserDataPath (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data") `
        -DestinationRoot $chromeOut

    Write-Info "Backing up Edge bookmarks..."
    Backup-BookmarksFromBrowser `
        -BrowserName "Edge" `
        -UserDataPath (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data") `
        -DestinationRoot $edgeOut

    Write-Info "Backing up mapped network drives..."
    Backup-MappedDrives -BackupRoot $backupRoot

    Write-Manifest -BackupRoot $backupRoot

    Write-Good ""
    Write-Good "Backup completed."
    Write-Good "Backup location: $backupRoot"
    if ($LicenseType -eq "F3") {
        Write-Good "This NAS backup will be deleted automatically after a successful restore."
    }
}

# ----------------------------
# Restore
# ----------------------------
function Invoke-Restore {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("E3", "F3")]
        [string]$LicenseType
    )

    $backupRoot = Get-BackupRoot -LicenseType $LicenseType

    $autoIn   = Join-Path $backupRoot "AutoDest"
    $custIn   = Join-Path $backupRoot "CustDest"
    $chromeIn = Join-Path $backupRoot "BrowserBackup\Chrome"
    $edgeIn   = Join-Path $backupRoot "BrowserBackup\Edge"

    $autoDst = Join-Path $env:APPDATA "Microsoft\Windows\Recent\AutomaticDestinations"
    $custDst = Join-Path $env:APPDATA "Microsoft\Windows\Recent\CustomDestinations"

    if (-not (Test-Path -LiteralPath $backupRoot)) {
        throw "Backup root not found: $backupRoot"
    }
    if (-not (Test-Path -LiteralPath $autoIn)) {
        throw "AutoDest backup not found: $autoIn"
    }
    if (-not (Test-Path -LiteralPath $custIn)) {
        throw "CustDest backup not found: $custIn"
    }

    Ensure-Folder -Path $autoDst
    Ensure-Folder -Path $custDst

    $restoreSucceeded = $false

    try {
        Write-Info "Closing Chrome and Edge..."
        Stop-ProcessSafe -Name "chrome"
        Stop-ProcessSafe -Name "msedge"

        Write-Info "Stopping Explorer..."
        Stop-ProcessSafe -Name "explorer"
        Start-Sleep -Seconds 2

        # Restore mapped drives FIRST so network-drive pins have the best chance to work
        Write-Info "Restoring mapped network drives..."
        Restore-MappedDrives -BackupRoot $backupRoot

        Write-Info "Restoring AutomaticDestinations..."
        Copy-Item -Path (Join-Path $autoIn "*") -Destination $autoDst -Force

        Write-Info "Restoring CustomDestinations..."
        Copy-Item -Path (Join-Path $custIn "*") -Destination $custDst -Force

        $srcExplorerQuickAccess = Join-Path $autoIn $ExplorerQuickAccessFile
        $dstExplorerQuickAccess = Join-Path $autoDst $ExplorerQuickAccessFile
        if (Test-Path -LiteralPath $srcExplorerQuickAccess) {
            Copy-Item -Path $srcExplorerQuickAccess -Destination $dstExplorerQuickAccess -Force
            Write-Good "Explorer Quick Access file restored."
        } else {
            Write-WarnMsg "Explorer Quick Access file was not found in backup."
        }

        Write-Info "Restoring Chrome bookmarks..."
        Restore-BookmarksToBrowser `
            -BrowserName "Chrome" `
            -SourceRoot $chromeIn `
            -UserDataPath (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data")

        Write-Info "Restoring Edge bookmarks..."
        Restore-BookmarksToBrowser `
            -BrowserName "Edge" `
            -SourceRoot $edgeIn `
            -UserDataPath (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data")

        $restoreSucceeded = $true
        Write-Good ""
        Write-Good "Restore completed."
    }
    finally {
        if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
            Start-Process explorer.exe
        }
    }

    if ($LicenseType -eq "F3" -and $restoreSucceeded) {
        $userFolder = Split-Path $backupRoot -Parent
        if (Test-Path -LiteralPath $userFolder) {
            try {
                Remove-Item -Path $userFolder -Recurse -Force -ErrorAction Stop
                Write-Good "F3 cleanup completed. NAS temp backup deleted: $userFolder"
            } catch {
                Write-WarnMsg "Restore succeeded, but NAS cleanup failed: $($_.Exception.Message)"
            }
        }
    }
}

# ----------------------------
# Prompt
# ----------------------------
Write-Host ""
Write-Host "Choose what you want to do:" -ForegroundColor Cyan
Write-Host "1. Backup (run on OLD laptop)"
Write-Host "2. Restore (run on NEW laptop)"
$actionChoice = Read-Host "Enter 1 or 2"

switch ($actionChoice) {
    "1" { $action = "Backup" }
    "2" { $action = "Restore" }
    default { throw "Invalid selection. Enter 1 or 2." }
}

Write-Host ""
Write-Host "Choose the user's license type:" -ForegroundColor Cyan
Write-Host "1. E3 - previously used Word and Excel desktop apps"
Write-Host "2. F3 - previously only used Word and Excel on the web"
$licenseChoice = Read-Host "Enter 1 or 2"

switch ($licenseChoice) {
    "1" { $licenseType = "E3" }
    "2" { $licenseType = "F3" }
    default { throw "Invalid selection. Enter 1 or 2." }
}

Write-Host ""
Write-Info "Selected action: $action"
Write-Info "Selected license type: $licenseType"
Write-Host ""

if ($action -eq "Backup") {
    Invoke-Backup -LicenseType $licenseType
} else {
    Invoke-Restore -LicenseType $licenseType
}