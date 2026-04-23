# Use the official Microsoft development container image for Node.js 20
FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bullseye

# Install build essentials for native modules like bcrypt
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends build-essential python3

# Set the working directory
WORKDIR /workspace

# Pre-install popular packages globally for the environment
RUN su node -c "npm install -g express dotenv bcrypt crypto-js"

# Set the default user to 'node'
USER node
