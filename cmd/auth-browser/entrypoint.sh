#!/bin/sh
set -eu

export DISPLAY=:99
mkdir -p /tmp/.X11-unix /tmp/acb-browser

pids=""
shutdown() {
  trap - INT TERM EXIT
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    wait $pids 2>/dev/null || true
  fi
}
trap shutdown INT TERM EXIT

Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
xvfb_pid=$!
pids="$xvfb_pid"

attempt=0
while [ ! -S /tmp/.X11-unix/X99 ]; do
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "Xvfb exited before the display was ready" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    echo "Timed out waiting for Xvfb" >&2
    exit 1
  fi
  sleep 0.1
done

openbox-session &
openbox_pid=$!
pids="$pids $openbox_pid"

x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 &
x11vnc_pid=$!
pids="$pids $x11vnc_pid"

websockify --web /usr/share/novnc 6080 localhost:5900 &
websockify_pid=$!
pids="$pids $websockify_pid"

/auth-browser &
controller_pid=$!
pids="$pids $controller_pid"

while :; do
  for pid in $pids; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || status=$?
      echo "Required auth-browser process $pid exited (status ${status:-0})" >&2
      exit 1
    fi
  done
  sleep 1
done
