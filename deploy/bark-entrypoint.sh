#!/usr/bin/env sh
set -e

if [ -f /run/secrets/bark_basic_auth_user ]; then
    export BARK_SERVER_BASIC_AUTH_USER="$(cat /run/secrets/bark_basic_auth_user | tr -d '\r\n')"
fi

if [ -f /run/secrets/bark_basic_auth_password ]; then
    export BARK_SERVER_BASIC_AUTH_PASSWORD="$(cat /run/secrets/bark_basic_auth_password | tr -d '\r\n')"
fi

exec bark-server "$@"
