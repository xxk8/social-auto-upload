#!/usr/bin/env bash
# From repo root: ./dev-web.sh
exec bash "$(cd "$(dirname "$0")" && pwd)/sau_web/start.sh"
