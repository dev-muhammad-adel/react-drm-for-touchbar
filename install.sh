#!/usr/bin/env bash

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

if (( EUID == 0 )); then
	exec "$INSTALLER" --react-drm-only
fi

command -v sudo >/dev/null 2>&1 || {
	printf 'react-drm: sudo is required\n' >&2
	exit 1
}
exec sudo "$INSTALLER" --react-drm-only
