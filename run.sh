#!/bin/bash
cd `dirname $0`
venv/bin/python main.py follow
venv/bin/python main.py follower
