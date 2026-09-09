#!/usr/bin/env bash

cleanup_unused_images() {
  docker image prune -f >/dev/null
}
