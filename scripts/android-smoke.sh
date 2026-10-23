#!/usr/bin/env bash
# Emulator smoke test: install the APK, open a spot through a deep link, wait for a live forecast,
# take screenshots, and fail on crashes or WebView console errors.
#   scripts/android-smoke.sh <apk> <out-dir>
set -uo pipefail
APK="$1"
OUT="$2"
PKG=io.github.githintz.glowcast
mkdir -p "$OUT"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
for s in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global $s 0; done

adb install -r -g "$APK" || { echo "::error::APK install failed"; exit 1; }
adb shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION || true
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb emu geo fix 8.5417 47.3769 || true
adb logcat -c

# 1) plain launch → main view
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 12
adb exec-out screencap -p > "$OUT/01-launch.png"

# 2) deep link to a spot → live forecast
adb shell "am start -W -a android.intent.action.VIEW -d 'glowcast://spot?spot=47.3769,8.5417&name=Zurich' $PKG"
ok=0
for i in $(seq 1 75); do
  if adb logcat -d | grep -q '\[glowcast\] forecast-ready'; then ok=1; break; fi
  sleep 2
done
sleep 3
adb exec-out screencap -p > "$OUT/02-forecast.png"
adb logcat -d -v threadtime > "$OUT/logcat.txt"
grep -h '\[glowcast\]' "$OUT/logcat.txt" | tail -5

fail=0
if [ "$ok" != "1" ]; then echo "::error::No '[glowcast] forecast-ready' line within 150 s"; fail=1; fi
if grep -q 'FATAL EXCEPTION' "$OUT/logcat.txt"; then echo "::error::FATAL EXCEPTION in logcat"; grep -A20 'FATAL EXCEPTION' "$OUT/logcat.txt" | head -40; fail=1; fi
# Capacitor forwards console.error as error-level "Capacitor/Console" lines
if grep -E ' E Capacitor/Console' "$OUT/logcat.txt" | grep -v 'favicon'; then echo "::error::WebView console error(s)"; fail=1; fi
if grep -q 'forecast-ready.*next=none' "$OUT/logcat.txt"; then echo "::warning::Forecast loaded but no upcoming event"; fi
exit $fail
