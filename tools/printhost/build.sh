#!/bin/bash
# Build printhost.exe for Windows (7 and up, 32-bit so it also runs on old 32-bit PCs).
# Needs: apt-get install gcc-mingw-w64-i686
set -e
cd "$(dirname "$0")"
i686-w64-mingw32-gcc -O2 -s -std=c99 -Wall -Wextra -Wno-unused-parameter -mwindows -static -o printhost.exe printhost.c -lws2_32 -lwinspool
# the till and the admin offer it for download
cp printhost.exe ../../apps/pos/public/printhost.exe
cp printhost.exe ../../apps/admin/public/printhost.exe
ls -la printhost.exe
