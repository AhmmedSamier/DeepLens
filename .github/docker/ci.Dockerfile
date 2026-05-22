FROM ubuntu:24.04

# System dependencies for VS Code headless tests
RUN apt-get update -yq && \
    apt-get install -yq --no-install-recommends \
        xvfb \
        libasound2t64 \
        libatk1.0-0t64 \
        libgbm1 \
        libgtk-3-0t64 \
        libnss3 \
        libxkbfile1 \
        libxss1 \
        ca-certificates \
        curl \
        git \
        nodejs \
        unzip \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install bun runtime
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null

# Pre-populate bun package cache for faster CI installs
COPY vscode-extension/bun.lock vscode-extension/package.json /tmp/vscode/
COPY language-server/bun.lock language-server/package.json /tmp/language-server/
RUN cd /tmp/vscode && bun install --frozen-lockfile && \
    cd /tmp/language-server && bun install --frozen-lockfile && \
    rm -rf /tmp/vscode /tmp/language-server
