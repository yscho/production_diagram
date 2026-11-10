#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node qa/headless_qa.js
