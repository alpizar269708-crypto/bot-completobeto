#!/bin/sh
# Render's Node image may expose Python 3.10 while youtube-dl-exec's
# preinstall guard requires 3.11. The bot installs yt-dlp in postinstall;
# this only bypasses the package's version gate, not Python itself.
export YOUTUBE_DL_SKIP_PYTHON_CHECK=1
exec /bin/sh "$@"
