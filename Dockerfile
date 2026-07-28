FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build

FROM nginx:stable-alpine

# bash is required by the entrypoint substitution script.
RUN apk add --no-cache bash

# Angular application output (default builder path: dist/<project>/browser).
COPY --from=build /app/dist/fourletters-gui/browser /usr/share/nginx/html

# Entrypoint substitutes __VAR__ placeholders in the built files at container start.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# SPA fallback + reverse proxy for the server and hub services.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint.sh"]
