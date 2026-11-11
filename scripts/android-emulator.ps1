param(
    [switch]$Clean,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repo = Join-Path $PSScriptRoot ".."
$appId = "dev.nullnotes.app"

if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not $env:NDK_HOME) { $env:NDK_HOME = Join-Path $env:ANDROID_HOME "ndk\29.0.14206865" }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21" }

$adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
    Write-Error "adb not found at $adb. Set ANDROID_HOME to your Android SDK."
    exit 1
}

Push-Location $repo
try {
    if (-not $SkipBuild) {
        Write-Host "Building debug APK (x86_64)..." -ForegroundColor Cyan
        npx tauri android build --debug --target x86_64
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Build failed."
            exit $LASTEXITCODE
        }
    }

    $apkDir = Join-Path $repo "src-tauri\gen\android\app\build\outputs\apk"
    $apk = Get-ChildItem $apkDir -Recurse -Filter "*x86_64*debug*.apk" -File |
        Select-Object -First 1
    if (-not $apk) {
        Write-Error "APK not found in: $apkDir"
        exit 1
    }

    $devices = (& $adb devices) | Select-String -Pattern "\tdevice$"
    if (-not $devices) {
        Write-Error "No emulator or device in 'adb devices'. Start the AVD first."
        exit 1
    }

    if ($Clean) {
        Write-Host "Uninstalling $appId (clean install)..." -ForegroundColor Cyan
        & $adb uninstall $appId | Out-Null
    }

    Write-Host "Installing $($apk.Name)..." -ForegroundColor Cyan
    & $adb install -r $apk.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Install failed. If the signature differs, rerun with -Clean."
        exit $LASTEXITCODE
    }

    & $adb logcat -c
    Write-Host "Launching $appId..." -ForegroundColor Green
    & $adb shell monkey -p $appId -c android.intent.category.LAUNCHER 1 | Out-Null
} finally {
    Pop-Location
}
