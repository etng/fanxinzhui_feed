#!/usr/bin/env bash
# Copy a downloaded file or folder onto the NAS over plain ssh.
#
# The NAS ships a chrooted sftp-server (it only exposes /home, /docker,
# /HomeTheater) and its rsync receiver is broken, so neither sftp/rclone nor
# rsync can reach /volume3. A regular ssh shell can, and `tar`/`cat` stream the
# bytes without shell-quoting the UTF-8 path on the remote side.
#
#   tools/push-to-nas.sh <local path> <remote dir>
#
# NAS_HOST overrides the ssh alias (default nas166).
set -euo pipefail

HOST=${NAS_HOST:-nas166}
if [ $# -ne 2 ]; then
  echo "usage: $0 <local file|dir> <remote dir>" >&2
  exit 2
fi
src=$1
destdir=$2
name=$(basename "$src")
[ -e "$src" ] || { echo "no such path: $src" >&2; exit 2; }

ssh -o BatchMode=yes "$HOST" "mkdir -p \"$destdir\""

if [ -d "$src" ]; then
  COPYFILE_DISABLE=1 tar -C "$(dirname "$src")" --no-xattrs -cf - "$name" | ssh -o BatchMode=yes "$HOST" "tar -C \"$destdir\" -xf -"
  echo "$name/ -> $HOST:$destdir"
else
  # write to a dotfile first so an interrupted upload never looks complete
  ssh -o BatchMode=yes "$HOST" "cat > \"$destdir/.$name.part\" && mv -f \"$destdir/.$name.part\" \"$destdir/$name\"" < "$src"
  local_size=$(wc -c < "$src" | tr -d ' ')
  remote_size=$(ssh -o BatchMode=yes "$HOST" "wc -c < \"$destdir/$name\"" | tr -d ' ')
  if [ "$local_size" != "$remote_size" ]; then
    echo "size mismatch: local=$local_size remote=$remote_size" >&2
    exit 1
  fi
  echo "$name -> $HOST:$destdir ($local_size bytes)"
fi
