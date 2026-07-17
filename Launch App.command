#!/bin/bash
cd "$(dirname "$0")"

PORT=8000
URL="http://localhost:$PORT"

if ! lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting Recipe Finder server on port $PORT..."
  nohup python3 -m http.server "$PORT" >/tmp/protein-recipe-app-server.log 2>&1 &
  disown
  sleep 1
else
  echo "Server already running on port $PORT."
fi

open "$URL"

echo ""
echo "Recipe Finder is running at $URL"
echo "You can close this window — the server keeps running in the background."
echo "To stop it later, run: lsof -ti:$PORT | xargs kill"
