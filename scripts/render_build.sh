#!/usr/bin/env bash
# Invoked by Dockerfile at build time, never when a student opens the app.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
python -m pip install --no-cache-dir -r requirements-timestamps.txt
python -m scripts.download_timestamp_model
python -m scripts.prepare_japji_audio
