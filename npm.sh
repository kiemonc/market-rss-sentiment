#!/bin/bash
# Helper script to run npm commands with NVM-installed Node.js
export PATH="/home/users/mchmielecki/.nvm/versions/node/v24.8.0/bin:$PATH"
npm "$@"
