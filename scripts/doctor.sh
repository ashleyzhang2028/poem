#!/usr/bin/env bash
# 开通自检的便捷入口（等价于 node scripts/doctor.js "$@"）
set -e
cd "$(dirname "$0")/.."
exec node scripts/doctor.js "$@"
