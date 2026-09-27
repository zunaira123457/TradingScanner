#!/bin/sh
# Runs the production (standalone) build the same way the Docker image does.
set -e
cd "$(dirname "$0")/.."
rm -rf .e2e-data
cp -r public .next/standalone/
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/
exec node .next/standalone/server.js
