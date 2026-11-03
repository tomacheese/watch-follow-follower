#!/bin/sh

while :
do
  pnpm start || true

  # Wait 30 minutes
  sleep 1800
done
