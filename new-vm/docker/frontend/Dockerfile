FROM node:22.19.0-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ unzip \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /src
COPY package.json ./
COPY scripts ./scripts
COPY controller ./controller
COPY shared ./shared
COPY services ./services
COPY frontend ./frontend
COPY frontend/desktop/project.mjs ./frontend/desktop/project.mjs
COPY AGENTS.md ./
COPY new-vm/docker/frontend/build.sh /tmp/build-frontend.sh
RUN chmod 755 /tmp/build-frontend.sh && /tmp/build-frontend.sh

FROM node:22.19.0-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
COPY new-vm/docker/frontend/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=4783
EXPOSE 4783
HEALTHCHECK --interval=20s --timeout=5s --start-period=90s --retries=10 \
  CMD curl -fsS http://127.0.0.1:4783/ >/dev/null
ENTRYPOINT ["/entrypoint.sh"]
