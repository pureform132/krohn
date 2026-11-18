#!/usr/bin/env bash
# Runs INSIDE the throwaway sshd container started by scripts/ci/start_test_sshd.sh
# (mounted read-only at /setup). Expects the keys at /keys: host_ed25519{,.pub} and
# authorized_keys. Installs openssh-server, adds user `krohn` that accepts only the
# test key, and execs sshd in the foreground.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends openssh-server >/dev/null

install -m 600 /keys/host_ed25519 /etc/ssh/ssh_host_ed25519_key
install -m 644 /keys/host_ed25519.pub /etc/ssh/ssh_host_ed25519_key.pub

useradd -m -s /bin/bash krohn
usermod -p '*' krohn  # no password, but not locked: key auth still works
install -d -m 700 -o krohn -g krohn /home/krohn/.ssh
install -m 600 -o krohn -g krohn /keys/authorized_keys /home/krohn/.ssh/authorized_keys

# AcceptEnv lets the SendEnv passthrough test reach the remote shell.
cat > /etc/ssh/sshd_config.d/krohn-test.conf <<'EOF'
HostKey /etc/ssh/ssh_host_ed25519_key
PasswordAuthentication no
AcceptEnv KROHN_RB_*
EOF

mkdir -p /run/sshd
exec /usr/sbin/sshd -D -e
