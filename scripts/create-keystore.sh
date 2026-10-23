#!/usr/bin/env bash
# One-time setup of a persistent Android signing key, stored only in GitHub repository secrets.
# Needs: keytool (any JDK) and the GitHub CLI logged in (`gh auth login`). Never commit the keystore.
#   bash scripts/create-keystore.sh githintz/Sunset-tracker
set -euo pipefail
REPO="${1:-githintz/Sunset-tracker}"
DIR=$(mktemp -d)
PASS=$(openssl rand -base64 24 | tr -d '/+=')
keytool -genkeypair -keystore "$DIR/glowcast.jks" -storepass "$PASS" -keypass "$PASS" -alias glowcast \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Glowcast, O=Personal" -noprompt
base64 -w0 "$DIR/glowcast.jks" | gh secret set ANDROID_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$PASS" | gh secret set KEYSTORE_PASSWORD -R "$REPO"
printf 'glowcast' | gh secret set KEY_ALIAS -R "$REPO"
printf '%s' "$PASS" | gh secret set KEY_PASSWORD -R "$REPO"
echo "Secrets set on $REPO. Keep a private backup of $DIR/glowcast.jks and the password below, then delete the folder."
echo "Password: $PASS"
