#!/bin/sh
# ./release.sh  builds jevit.xpi only if node test.js passes (set TYPESAFE_API_KEY or OPENROUTER_API_KEY to include the live check)
set -e
cd "$(dirname "$0")"

[ -n "$TYPESAFE_API_KEY$OPENROUTER_API_KEY" ] || echo "no API key set: skipping the live check against Jev"
node test.js

# zip adds to an existing archive, so start fresh to keep removed files out
rm -f jevit.xpi
zip -q jevit.xpi manifest.json LICENSE icon-*.png jev.js background.js popup.* options.* help.html style.css
echo "jevit.xpi $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)"
