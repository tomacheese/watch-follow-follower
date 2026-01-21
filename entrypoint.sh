#!/bin/sh

while :
do
  pnpm start || true

  # 30 分待機
  sleep 1800
done
