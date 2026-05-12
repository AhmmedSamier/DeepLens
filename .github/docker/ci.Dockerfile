FROM ubuntu:24.04

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
        unzip \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
