# watch-follow-follower

Version 3 of a lightweight checker that captures X (Twitter) follower/following snapshots, diffs changes, and optionally posts a Discord notification.

## Features
- Fetch followers and following for a target account
- Save snapshots as JSON and compute diffs on subsequent runs
- Optional Discord webhook notifications
- Cookie cache to reduce login frequency
- Optional proxy support

## Requirements
- Node.js (see .node-version for the current version)
- pnpm

## Setup

```bash
pnpm install
```

### Configuration
You can use either a config file or environment variables.

1) Copy the sample config:

```bash
mkdir -p data
cp config.sample.json data/config.json
```

2) Edit `data/config.json` with your credentials.

The default config path is `./data/config.json`. You can override it with `CONFIG_PATH`.
The Docker image sets `CONFIG_PATH`, `OUTPUT_DIR`, and `COOKIE_CACHE_PATH` to `/data/...`, so mount the host `./data` directory to `/data`.

### Run

```bash
pnpm start
```

## Environment Variables

Required (if not using config file):
- `TWITTER_USERNAME`
- `TWITTER_PASSWORD`

Optional:
- `TWITTER_EMAIL_ADDRESS`
- `TWITTER_AUTH_CODE_SECRET` (2FA secret)
- `TWITTER_TARGET_USERNAME` or `TARGET_USERNAME` (defaults to login username)
- `CONFIG_PATH` (default: `./data/config.json`)
- `OUTPUT_DIR` (default: `./data`)
- `COOKIE_CACHE_PATH` (default: `./data/twitter-cookies.json`)
- `PROXY_SERVER` (format: `host:port` or `http(s)://host:port`)
- `PROXY_USERNAME`
- `PROXY_PASSWORD`

## Output

Snapshots and diff files are saved under:

```
<OUTPUT_DIR>/<targetUsername>/{followers.json,following.json,diff.json}
```

The `diff.json` file is generated only if a previous snapshot exists.

## Docker

Build and run (config file):

```bash
docker build -t watch-follow-follower .
docker run --rm \
  -v $(pwd)/data:/data \
  watch-follow-follower
```

Run with environment variables instead of a config file:

```bash
docker run --rm \
  -e TWITTER_USERNAME=... \
  -e TWITTER_PASSWORD=... \
  -e TWITTER_EMAIL_ADDRESS=... \
  -v $(pwd)/data:/data \
  watch-follow-follower
```

The Docker image runs `pnpm start` every 30 minutes via `entrypoint.sh`.

### Docker Compose
If you prefer Docker Compose, ensure `data/config.json` exists and run:

```bash
docker compose up --build
```

## Notes
- This project relies on unofficial APIs. Usage may break due to upstream changes.
- Keep your credentials and cookie cache private.
- `data/` should never be committed; it is ignored by default.

## License
MIT
