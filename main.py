import argparse
import json
import os
import sys

import requests


def getDataIds(endpoint: str, config: dict):
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
        print("[Error] " + str(response.status_code))
        error_code = response.json()["errors"][0]["code"]
        if not os.path.exists("userdata.json"):
            return None, None, error_code

        with open("userdata.json", "r") as f:
            userdata = json.load(f)
            if userid in userdata:
                return userdata[userid]["name"], userdata[userid]["screen_name"], response.status_code
            else:
                return None, None, error_code

    data = response.json()

    if not os.path.exists("userdata.json"):
        userdata = {}
    else:
        with open("userdata.json", "r") as f:
            userdata = json.load(f)

    userdata[userid] = {
        "name": data["name"],
        "screen_name": data["screen_name"]
    }

    with open("userdata.json", "w") as f:
        f.write(json.dumps(userdata))

    return data["name"], data["screen_name"], response.status_code


def saveUsersData(userids: list, config: dict) -> bool:
    print("[INFO] saveUsersData({userids}, {config})".format(
        userids=userids, config=config))
    headers = {
        "Authorization": "Bearer {token}".format(token=config["bearer_token"])
    }
    params = {
        "user_id": ",".join(userids)
    }
    response = requests.get("https://api.twitter.com/1.1/users/lookup.json",
                            headers=headers, params=params)
    if response.status_code != 200:
        print("[Error] " + str(response.status_code))
        return False

    data = response.json()

    if not os.path.exists("userdata.json"):
        userdatas = {}
    else:
        with open("userdata.json", "r") as f:
            userdatas = json.load(f)

    for userdata in data:
        userid = userdata["id_str"]
        name = userdata["name"]
        screen_name = userdata["screen_name"]
        userdatas[userid] = {
            "name": name,
            "screen_name": screen_name
        }

    with open("userdata.json", "w") as f:
        f.write(json.dumps(userdatas))

    return True


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
        "https://discord.com/api/channels/{channelId}/messages".format(channelId=channelId), headers=headers,
        json=params)
    print("[INFO] response: {code}".format(code=response.status_code))
    print("[INFO] response: {message}".format(message=response.text))


def main(target: str, isInit: bool):
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

    if not os.path.exists("{target}_data.json".format(target=target)) or isInit:
        print("[INFO] Initialize mode")

        with open("{target}_data.json".format(target=target), "w") as f:
            f.write(json.dumps(ids))

        slicedIds = [ids[i:i + 100] for i in range(0, len(ids), 100)]
        for ids in slicedIds:
            saveUsersData(ids, config)

        print("[INFO] Initialized.")
        return

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

        messages.append(
            "`{name}` `@{screen_name}` ({code}) {url}".format(name=name, screen_name=screen_name, code=code, url=url))

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


os.chdir(sys.path[0])

parser = argparse.ArgumentParser()
parser.add_argument("target", help="Check target", choices=["follow", "follower"])
parser.add_argument("--init", help="Initialize mode", default=False, action="store_true")
args = parser.parse_args()

main(args.target, args.init)
