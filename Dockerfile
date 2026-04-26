FROM node:22-bookworm

# Install build dependencies for Valhalla
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    git \
    wget \
    unzip \
    cmake \
    autoconf \
    automake \
    libtool \
    pkg-config \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Emscripten
RUN git clone https://github.com/emscripten-core/emsdk.git /opt/emsdk && \
    cd /opt/emsdk && \
    ./emsdk install latest && \
    ./emsdk activate latest

ENV PATH="/opt/emsdk:/opt/emsdk/upstream/emscripten:${PATH}"
ENV EMSDK="/opt/emsdk"

WORKDIR /workspace

CMD ["/bin/bash"]
