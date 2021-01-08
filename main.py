import requests
import json
import os
import argparse

def getDataIds(endpoint: str, config: dict) -> list[str]:
    print("[INFO] getDataIds({endpoint}, {config})".format(
        endpoint=endpoint, config=config))
    headers = {
        "Authorization": "Bearer " + config["bearer_token"]
    }
    params = {
        "user_id": config["userid"],
        "count": 5000,
        "stringify_ids": True
    }
    response = requests.get(endpoint, headers=headers, params=params)
    if response.status_code != 200:
        print("[Error] " + str(response.status_code))
        print("[Error] " + str(response.text))
        return None
    return response.json()["ids"]


def getUserData(userid: str, config: dict) -> tuple:
    print("[INFO] getUserData({userid}, {config})".format(
        userid=userid, config=config))
    headers = {
        "Authorization": "Bearer {token}".format(token=config["bearer_token"])
    }
    params = {
        "user_id": userid
    }
    response = requests.get("https://api.twitter.com/1.1/users/show.json",
                            headers=headers, params=params)
    if response.status_code != 200:
        print("[Error] " + response.status_code)
        error_code = response.json()["errors"][0]["code"]
        return None, None, error_code

    data = response.json()
    return data["name"], data["screen_name"], response.status_code


def sendMessage(channelId: str, message: str, config: dict):
    print("[INFO] sendMessage: {message}".format(message=message))
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bot {token}".format(token=config["discord_token"]),
        "User-Agent": "Bot"
    }
    params = {
        "content": message
    }
    response = requests.post(
        "https://discord.com/api/channels/{channelId}/messages".format(channelId=channelId), headers=headers, json=params)
    print("[INFO] response: {code}".format(code=response.status_code))
    print("[INFO] response: {message}".format(message=response.text))

def main(target: str):
    print("[INFO] main({target})".format(target=target))
    if not os.path.exists("config.json"):
        print("[Error] config.json not found")
        return
    with open("config.json", "r") as f:
        config = json.load(f)

    if target == "follow":
        endpoint = "https://api.twitter.com/1.1/friends/ids.json"
    elif target == "follower":
        endpoint = "https://api.twitter.com/1.1/followers/ids.json"
    else:
        raise ValueError("target only supports follow and follower.")

    ids = getDataIds(endpoint, config)
    if ids is None:
        print("[Error] API request failed.")
        return

    ids_old = []
    finalIds_old = []
    if os.path.exists("{target}_data.json".format(target=target)):
        with open("{target}_data.json".format(target=target), "r") as f:
            ids_old = json.load(f)
            finalIds_old = ids_old

    # New follow(er) users
    messages = [":new:**New {target} users**".format(target=target)]
    for id in ids:
        if id in ids_old and id in finalIds_old:
            finalIds_old.remove(id)
            continue
        name, screen_name, code = getUserData(id, config)
        url = "https://twitter.com/intent/user?user_id={userid}".format(userid=id)

        messages.append("`{name}` `@{screen_name}` ({code}) {url}".format(name=name, screen_name=screen_name, code=code, url=url))

    if len(messages) > 1:
        sendMessage(config["discord_{target}_channel".format(target=target)], "\n".join(messages), config)

    # Unfollow(er) users
    messages = [":wave:**Un{target} users**".format(target=target)]
    for id in finalIds_old:
        name, screen_name, code = getUserData(id, config)
        url = "https://twitter.com/intent/user?user_id={userid}".format(
            userid=id)

        messages.append("`{name}` `@{screen_name}` ({code}) {url}".format(
            name=name, screen_name=screen_name, code=code, url=url))

    if len(messages) > 1:
        sendMessage(config["discord_{target}_channel".format(target=target)], "\n".join(messages), config)

    with open("{target}_data.json".format(target=target), "w") as f:
        f.write(json.dumps(ids))


parser = argparse.ArgumentParser()
parser.add_argument("target", help="follow or follower")
args = parser.parse_args()

main(args.target)
