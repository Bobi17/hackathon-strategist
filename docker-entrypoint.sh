#!/bin/sh
# ── Container entrypoint — fix bind-mount ownership, then drop to strategist ──
#
# docker-compose mounts the host's `./output` at `/app/output`. A bind mount
# keeps the host's ownership (root in CI, or the host user's UID), which the
# non-root `strategist` container user (UID 1000) can't always create subdirs
# in — `mkdir output/<slug>/.cache` fails with EACCES and the whole run aborts.
#
# The container starts as root (the Dockerfile's last USER is root, so the
# entrypoint runs as root). It chowns the mounted output dir to the strategist
# user so the app can write subdirs into it, then uses `gosu` to drop
# privileges and exec the real command as the non-root strategist user.
# Anything that must run as root (e.g. chown on the bind mount) happens here,
# before the drop.
set -e

APP_USER="strategist"
APP_UID="$(id -u "$APP_USER")"
APP_GID="$(id -g "$APP_USER")"

# Fix ownership of the bind-mounted output dir so UID 1000 can create subdirs
# (`mkdir output/<slug>/.cache`) into it. `output/` is the only host bind mount
# the app writes to; `config/` and `.env.local` are mounted read-only.
#
# We chown the mount ROOT only (non-recursive): mkdir needs the parent dir to
# be owned/writable, not any sibling files. Subdirs from prior runs are
# already owned by UID 1000 (created by this same image). A non-recursive
# chown avoids re-chowning a potentially large output tree on every start
# and never touches files the host may have dropped in from outside.
[ -d /app/output ] || mkdir -p /app/output
if [ "$(stat -c '%u:%g' /app/output)" != "${APP_UID}:${APP_GID}" ]; then
  chown "${APP_UID}:${APP_GID}" /app/output
fi

# Drop privileges and run the command as the non-root strategist user.
exec gosu "$APP_USER" "$@"
