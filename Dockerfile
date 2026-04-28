FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY index.html ./
COPY vite.config.js ./

# Build the frontend
RUN npm run build

# Expose ports
EXPOSE 3000 5173

# Start the app
CMD ["npm", "start"]