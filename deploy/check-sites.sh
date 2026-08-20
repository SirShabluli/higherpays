#!/bin/bash
# Quick sanity check: hit every site on the EC2 by Host header and print status.
for host in onlyfinder.today www.onlyfinder.today telescope.ora-town.com \
            shiftpro.54.173.144.0.nip.io propeller.54.173.144.0.nip.io \
            followup.54.173.144.0.nip.io higherpays.com www.higherpays.com; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: $host" http://127.0.0.1/)
  printf '%-42s HTTP %s\n' "$host" "$code"
done
