# Use the official Node.js 20 slim image
FROM node:20-bullseye-slim

# Set the working directory inside the container
WORKDIR /app

# Install OS dependencies required for native Node modules (bcrypt, sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application code (including src/, .env, etc.)
COPY . .

# Expose the port the Express app runs on
EXPOSE 3000

# Start the server using the start script from package.json
CMD ["npm", "start"]
