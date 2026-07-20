#!/bin/sh
# Deploy ctatracker to both machines:
#  - wall Pi (server.js under systemd): git pull + restart. Only the node
#    service — the poller no longer runs on the Pi.
#  - home server (poller in Docker): pushing to the bare repo triggers its
#    post-receive hook (checkout + docker compose up -d --build).
# Runtime state (data/, .env, node_modules/) is gitignored, so deploys never
# touch it.
set -e

PI=colinrecker@100.126.101.86

git push origin main
git push homeserver main
ssh "$PI" 'cd ~/Projects/ctatracker && git pull --ff-only && sudo systemctl restart ctatracker && sleep 2 && systemctl is-active ctatracker'
echo "Deployed."
