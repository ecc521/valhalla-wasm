FROM node:22-bookworm

# Install build dependencies for Valhalla
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    git \
    wget \
    curl \
    unzip \
    zip \
    tar \
    cmake \
    ninja-build \
    autoconf \
    automake \
    libtool \
    pkg-config \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Emscripten, pinned for reproducible builds (see versions.lock).
# Override with: docker build --build-arg EMSDK_VERSION=<version> .
ARG EMSDK_VERSION=6.0.0
RUN git clone https://github.com/emscripten-core/emsdk.git /opt/emsdk && \
    cd /opt/emsdk && \
    ./emsdk install "${EMSDK_VERSION}" && \
    ./emsdk activate "${EMSDK_VERSION}"

ENV PATH="/opt/emsdk:/opt/emsdk/upstream/emscripten:${PATH}"
ENV EMSDK="/opt/emsdk"

WORKDIR /workspace

CMD ["/bin/bash"]
