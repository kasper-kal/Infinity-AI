#!/bin/sh
# Installs the system libraries Chrome needs to run headless (Puppeteer).
# Idempotent — exits fast when the libraries are already installed.
# Used by the preview command so infinity-ai's personal browser works in
# minimal containers that lack Chrome's shared library dependencies.

set -e

DEPS="libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-6 libxcb1 libxext6 libxi6 libxtst6 libxss1 fonts-liberation"

# Already satisfied? (libglib-2.0 is the first thing Chrome loads)
if ldconfig -p 2>/dev/null | grep -q "libglib-2.0.so.0"; then
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends $DEPS
