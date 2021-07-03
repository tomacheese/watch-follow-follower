# WatchFollowFollower

Checks Twitter follow/follower changes and notifies Discord.

## Requirements

- Twitter API key, API secret key (From [apps.twitter.com](https://apps.twitter.com))
- Vaild Bearer token (Currently only Bearer token supported)
- Vaild Discord Bot token and Writeable message channel
-  Python 3.6+
- [requirements.txt](requirements.txt): `requests`

## Installation

1. Git Clone: `git clone https://github.com/book000/WatchFollowFollower.git`
2. Install dependency packages from `requirements.txt`: `pip3 install -U -r requirements.txt`

## Configuration

Rewrite [config.sample.json](config.sample.json) and rename to `config.json`.

## Usage

```shell
python3 /path/to/main.py <follow|follower> [--init]
```

`follow | follower` is required. If you add `--init`, all user data of followers will be reacquired.

If necessary, register it in Crontab, etc. and run it periodically.

## Notes

- Currently, only Bearer token supported. It has not yet been decided if it will be supported in the future.
  - For this reason, private accounts are not currently supported.

## Warning / Disclaimer

The developer is not responsible for any problems caused by the user using this project.

## License

The license for this project is [MIT License](LICENSE).
