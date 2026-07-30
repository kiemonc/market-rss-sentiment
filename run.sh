#!/bin/bash

# Helper script to run the app with NVM-installed Node.js
export PATH="/home/users/mchmielecki/.nvm/versions/node/v24.14.0/bin:$PATH"

# Load environment from .env if it exists
if [ -f "$(dirname "$0")/.env" ]; then
  set -a
  source "$(dirname "$0")/.env"
  set +a
fi

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Run the compiled app
node "$(dirname "$0")/dist/index.js"
