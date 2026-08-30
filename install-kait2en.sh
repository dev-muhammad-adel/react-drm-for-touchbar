#!/usr/bin/env bash
#
# react-drm installer — KaiT2en (T2 Fedora fork) profile.
#
# The KaiT2en-Fedora distro ships its own installer under
# scripts/fedora/install-apps.sh (this checkout lives inside that tree). This
# wrapper delegates to it, exactly as the KaiT2en distro depends on. It does not
# use this repo's standalone install.sh.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
KAIT2EN_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
INSTALLER="$KAIT2EN_ROOT/scripts/fedora/install-apps.sh"

case "${1:-}" in
	""|install) ;;
	*)
		printf 'usage: %s [install]\n' "${0##*/}" >&2
		exit 2
		;;
esac

if [[ ! -x "$INSTALLER" ]]; then
	printf 'react-drm: KaiT2en installer not found: %s\n' "$INSTALLER" >&2
	exit 1
fi

# Seed the KaiT2en hardware profile into the repo-root .env (loaded by the
# systemd service via EnvironmentFile). Never overwrite an existing .env.
if [[ -e "$SCRIPT_DIR/.env" ]]; then
	printf 'react-drm: keeping existing %s\n' "$SCRIPT_DIR/.env"
else
	printf 'react-drm: seeding %s from env.example.kait2en\n' "$SCRIPT_DIR/.env"
	cp "$SCRIPT_DIR/env.example.kait2en" "$SCRIPT_DIR/.env"
fi

# 99-react-drm.rules is generated (gitignored): copy the KaiT2en rules file
# into the canonical name the distro/deploy steps use.
printf 'react-drm: generating %s from 99-react-drm-kait2en.rules\n' "$SCRIPT_DIR/system/99-react-drm.rules"
cp -f "$SCRIPT_DIR/system/99-react-drm-kait2en.rules" "$SCRIPT_DIR/system/99-react-drm.rules"

if (( EUID == 0 )); then
	exec "$INSTALLER" --react-drm-only
fi

command -v sudo >/dev/null 2>&1 || {
	printf 'react-drm: sudo is required\n' >&2
	exit 1
}
exec sudo "$INSTALLER" --react-drm-only
