#!/usr/bin/env bash
# Provision limited deploy user on VPS
set -euo pipefail

DEPLOY_USER="deploy-gateway"
DEPLOY_DIR="/opt/bank-event-gateway"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root."
  exit 1
fi

echo "==> Creating deploy user '${DEPLOY_USER}'..."
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi

echo "==> Setting up directory ${DEPLOY_DIR}..."
mkdir -p "${DEPLOY_DIR}/data" "${DEPLOY_DIR}/credentials" "${DEPLOY_DIR}/secrets"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_DIR}"
chmod 750 "${DEPLOY_DIR}"

# Ensure data directory has write access for UID 1000 (container node user)
chown -R 1000:1000 "${DEPLOY_DIR}/data"
chmod 770 "${DEPLOY_DIR}/data"

echo "==> Adding deploy user to docker group..."
usermod -aG docker "$DEPLOY_USER"

echo "==> Provisioning complete. Add deployment SSH public key to /home/${DEPLOY_USER}/.ssh/authorized_keys"
