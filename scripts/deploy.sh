#!/bin/sh
# Deploy ctatracker to the wall Pi: push main, fast-forward the Pi's checkout,
# and restart both services. Runtime state (data/, .env, node_modules/) is
# gitignored, so a pull never touches it.
set -e

PI=colinrecker@192.168.12.191

git push origin main
ssh "$PI" 'cd ~/Projects/ctatracker && git pull --ff-only && sudo systemctl restart ctatracker ctatracker-poller && sleep 2 && systemctl is-active ctatracker ctatracker-poller'
echo "Deployed."
