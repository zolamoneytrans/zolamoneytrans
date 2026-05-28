# Zola Money Trans - Android Release Compilation Automator (JDK 17 & SDK Programmed)
$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   ZOLA MONEY TRANS AUTOMATED BUILD PIPELINE" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Enforce JDK 17 for Gradle/Capacitor build compatibility
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
Write-Host "Enforced compatible JDK at: $env:JAVA_HOME" -ForegroundColor Yellow

# 2. Configure Android SDK Environment Variables & local.properties
$sdkPath = "C:\Users\jgmsw\AppData\Local\Android\Sdk"
$env:ANDROID_HOME = $sdkPath
$env:ANDROID_SDK_ROOT = $sdkPath
Write-Host "Enforced Android SDK at: $env:ANDROID_HOME" -ForegroundColor Yellow

# Generate local.properties inside android directory
$localProps = "android/local.properties"
$sdkEscaped = $sdkPath -replace '\\', '/'
"sdk.dir=$sdkEscaped" | Out-File -FilePath $localProps -Encoding ascii -Force
Write-Host "Created local.properties pointing to: $sdkEscaped" -ForegroundColor Yellow

# 3. Ensure keystore exists
$keystorePath = "android/zola-upload.keystore"
if (-not (Test-Path $keystorePath)) {
    Write-Host "Generating signed upload keystore: $keystorePath..." -ForegroundColor Green
    $keytool = "$env:JAVA_HOME\bin\keytool.exe"
    
    # Generate keystore non-interactively
    & $keytool -genkeypair -v -keystore $keystorePath `
        -alias zola-key -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass christannepolytechnique1A -keypass christannepolytechnique1A `
        -dname "CN=Zola Money Trans, OU=Fintech, O=Zola Pay, L=Kinshasa, S=Kinshasa, C=CD"
        
    Write-Host "Keystore generated successfully!" -ForegroundColor Green
} else {
    Write-Host "Keystore already exists at $keystorePath. Skipping generation." -ForegroundColor Yellow
}

# 4. Sync client web assets to Android
Write-Host "Syncing client assets with Capacitor..." -ForegroundColor Green
npm run cap:sync

# Setup releases output directory
$releasesDir = "releases"
if (-not (Test-Path $releasesDir)) {
    New-Item -ItemType Directory -Path $releasesDir | Out-Null
}

# Define the targets: Version Code (Int), Version Name (String), Output filename
$targets = @(
    @{ Code = 106; Name = "1.0.6"; File = "releases/zola-pay-v1.0.6-b106.aab" },
    @{ Code = 107; Name = "1.0.7"; File = "releases/zola-pay-v1.0.7-b107.aab" },
    @{ Code = 108; Name = "1.0.8"; File = "releases/zola-pay-v1.0.8-b108.aab" }
)

# Move into Android directory to execute Gradle commands
Push-Location android

try {
    foreach ($target in $targets) {
        Write-Host ""
        Write-Host "---------------------------------------------" -ForegroundColor Gray
        Write-Host "Building Release: Version Name = $($target.Name), Version Code = $($target.Code)" -ForegroundColor Green
        Write-Host "---------------------------------------------" -ForegroundColor Gray
        
        # Set environment variables for Gradle to pick up
        $env:ANDROID_VERSION_CODE = $target.Code
        $env:ANDROID_VERSION_NAME = $target.Name
        
        Write-Host "Cleaning gradle..." -ForegroundColor Gray
        cmd.exe /c ".\gradlew.bat clean"
        
        Write-Host "Compiling release bundle (.aab)..." -ForegroundColor Gray
        cmd.exe /c ".\gradlew.bat bundleRelease"
        
        # Copy compiled bundle to final location
        $sourceBundle = "app/build/outputs/bundle/release/app-release.aab"
        if (Test-Path $sourceBundle) {
            $destPath = "../$($target.File)"
            Copy-Item -Path $sourceBundle -Destination $destPath -Force
            Write-Host "SUCCESS: Generated signed bundle at $destPath" -ForegroundColor Green
        } else {
            throw "Error: Compiled bundle could not be found at $sourceBundle"
        }
    }
}
finally {
    Pop-Location
    # Clear environment variables
    Remove-Item env:ANDROID_VERSION_CODE -ErrorAction SilentlyContinue
    Remove-Item env:ANDROID_VERSION_NAME -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   BUILD PIPELINE COMPLETED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
