#!/bin/sh
set -eu
# Railway mounts volumes as root. Prepare the private directory, then drop privileges.
if [ "$(id -u)" = "0" ]; then
  if [ "${SERVICE_ROLE:-web}" = "worker" ]; then
    mkdir -p "${MEDIA_ROOT:-/data/media}"
    chown node:node "${MEDIA_ROOT:-/data/media}"
    chmod 700 "${MEDIA_ROOT:-/data/media}"
  fi
  exec gosu node "$@"
fi
exec "$@"
