param(
    [switch]$Clean,
    [switch]$SkipBuild,
    [string]$Avd
)

$ErrorActionPreference = "Stop"

$repo = Join-Path $PSScriptRoot ".."
$appId = "dev.nullnotes.app"

if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not $env:NDK_HOME) { $env:NDK_HOME = Join-Path $env:ANDROID_HOME "ndk\29.0.14206865" }
# Gradle in this project fails on JDK 25 ("A problem occurred configuring project ':buildSrc'. > 25.0.1"), so pin JDK 21.
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

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
    $apk = Get-ChildItem $apkDir -Recurse -Filter "*debug*.apk" -File |
        Select-Object -First 1
    if (-not $apk) {
        Write-Error "APK not found in: $apkDir"
        exit 1
    }

    $devices = (& $adb devices) | Select-String -Pattern "\tdevice$"
    if (-not $devices) {
        $emulator = Join-Path $env:ANDROID_HOME "emulator\emulator.exe"
        if (-not $Avd) {
            $Avd = Get-ChildItem (Join-Path $env:USERPROFILE ".android\avd") -Filter "*.ini" -File |
                Select-Object -First 1 -ExpandProperty BaseName
        }
        if (-not $Avd -or -not (Test-Path $emulator)) {
            Write-Error "No device running and no AVD found. Pass -Avd <name> or start an emulator manually."
            exit 1
        }
        Write-Host "Starting emulator $Avd..." -ForegroundColor Cyan
        Start-Process $emulator -ArgumentList "-avd", $Avd
        & $adb wait-for-device
        while ((& $adb shell getprop sys.boot_completed 2>$null).Trim() -ne "1") {
            Start-Sleep -Seconds 2
        }
    }

    if ($Clean) {
        Write-Host "Uninstalling $appId (clean install)..." -ForegroundColor Cyan
        & $adb uninstall $appId | Out-Null
    }

    Write-Host "Installing $($apk.Name)..." -ForegroundColor Cyan
    $ErrorActionPreference = "Continue"
    $out = (& $adb install -r $apk.FullName 2>&1 | ForEach-Object { "$_" }) -join "`n"
    Write-Host $out
    if ($out -match "INSUFFICIENT_STORAGE") {
        # The ~1 GB debug APK doesn't fit alongside the installed copy. `-k` drops the old
        # package but keeps its data (OAuth tokens etc.), so the reinstall picks it back up.
        Write-Host "Not enough space; removing old package but keeping app data..." -ForegroundColor Yellow
        & $adb shell pm uninstall -k $appId | Out-Null
        & $adb install $apk.FullName
    }
    $ErrorActionPreference = "Stop"
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
