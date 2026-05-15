#!/usr/bin/env bash
set -e

ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
APK="app/build/outputs/apk/release/app-release.apk"
PACKAGE="com.vonhex.delamain"

JAVA_HOME="$HOME/.jdks/jbr-17.0.14"
GRADLE="$HOME/.gradle/wrapper/dists/gradle-8.4-bin/1w5dpkrfk8irigvoxmyhowfim/gradle-8.4/bin/gradle"

echo "Building..."
JAVA_HOME="$JAVA_HOME" "$GRADLE" assembleRelease

echo "Installing (spoofing Play Store installer for Android Auto)..."
"$ADB" install -r -i com.android.vending "$APK"

echo "Restarting Android Auto..."
"$ADB" shell am force-stop com.google.android.projection.gearhead

echo "Done. Tap the Delamain icon on your phone, then open Android Auto."
