#!/bin/bash

# Helper script to run the app with NVM-installed Node.js
export PATH="/home/users/mchmielecki/.nvm/versions/node/v24.8.0/bin:$PATH"

# Load environment from .env if it exists
if [ -f "$(dirname "$0")/.env" ]; then
  set -a
  source "$(dirname "$0")/.env"
  set +a
fi

# Run the app
node "$(dirname "$0")/src/index.js"
