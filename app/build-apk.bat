@echo off
rem Build a release APK with the toolchain kept in the KotobaBiyori project.
rem Keep this file ASCII-only with CRLF line endings: cmd misparses anything else.
setlocal
set "ANDROID_DIR=%~dp0android"
set "TOOLCHAIN=D:\Myproject\APPs\KotobaBiyori\.toolchain"
if not "%NIHONGO_TOOLCHAIN%"=="" set "TOOLCHAIN=%NIHONGO_TOOLCHAIN%"
rem The Gradle cache path is long enough that some React Native headers exceed
rem the Windows 260-character limit in ninja. A short directory junction points
rem at the same cache, so nothing is copied or downloaded again.
set "SHORT_GRADLE=D:\Myproject\.kbgradle"
if not exist "%SHORT_GRADLE%" mklink /J "%SHORT_GRADLE%" "%TOOLCHAIN%\gradle-home" >nul
set "JAVA_HOME=%TOOLCHAIN%\jdk"
set "ANDROID_HOME=%TOOLCHAIN%\android-sdk"
set "ANDROID_SDK_ROOT=%TOOLCHAIN%\android-sdk"
set "GRADLE_USER_HOME=%SHORT_GRADLE%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
pushd "%ANDROID_DIR%"
call "%ANDROID_DIR%\gradlew.bat" assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" exit /b %RESULT%
echo.
echo APK: %ANDROID_DIR%\app\build\outputs\apk\release\app-release.apk
endlocal
