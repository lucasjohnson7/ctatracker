#!/bin/sh
# Nightly backup of the wall Pi's irreplaceable state — pull-up/push-up
# counters (data/pullups.db), commute jsonl logs, layout/presence, and .env —
# to the home server. Runs from the Pi's crontab; keeps 14 days of tarballs.
set -e

HS=colinrecker@100.98.221.29
DEST_DIR=backups/ctatracker
STAMP=$(date +%Y%m%d)

cd "$HOME/Projects/ctatracker"
tar czf "/tmp/ctatracker-$STAMP.tar.gz" data .env
scp -q -o StrictHostKeyChecking=accept-new "/tmp/ctatracker-$STAMP.tar.gz" "$HS:$DEST_DIR/"
rm "/tmp/ctatracker-$STAMP.tar.gz"
ssh -o StrictHostKeyChecking=accept-new "$HS" "find ~/$DEST_DIR -name 'ctatracker-*.tar.gz' -mtime +14 -delete"
echo "backup ok: ctatracker-$STAMP.tar.gz"
