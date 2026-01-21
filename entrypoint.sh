#!/bin/sh

while :
do
  pnpm start || true

  # wait 30 minutes
  sleep 1800
done