# Base Image
FROM node:24-alpine

# Working Directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project
COPY . .

# Build the NestJS project
RUN npm run build

# Expose application port
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"]