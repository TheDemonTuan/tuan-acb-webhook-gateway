#!/bin/sh
set -eu
export DISPLAY=:99
mkdir -p /tmp/.X11-unix /tmp/acb-browser
chmod 1777 /tmp/.X11-unix
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
openbox-session &
x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 &
exec /auth-browser &
websockify --web /usr/share/novnc 6080 localhost:5900
