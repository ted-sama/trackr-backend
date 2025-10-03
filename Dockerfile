# syntax=docker/dockerfile:1.7

###############################################
# Base image with shared configuration
###############################################
FROM node:20-alpine3.19 AS base
ARG PNPM_VERSION=9.12.2
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /usr/src/app

###############################################
# Install dependencies (development)
###############################################
FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

###############################################
# Build the application
###############################################
FROM base AS build

ENV NODE_ENV=development
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN pnpm run build

###############################################
# Install production dependencies only
###############################################
FROM base AS prod-deps

ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

###############################################
# Final runtime image
###############################################
FROM base AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@${PNPM_VERSION}

COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/build ./build
COPY --from=build /usr/src/app/public ./public
COPY package.json ./package.json

EXPOSE 3333
CMD ["node", "build/bin/server.js"]
