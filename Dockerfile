FROM nvidia/cuda:12.8.1-base-ubuntu22.04

ARG WILDRIG_VERSION=0.48.9
ARG WILDRIG_URL=https://github.com/andru-kun/wildrig-multi/releases/download/${WILDRIG_VERSION}/wildrig-multi-linux-${WILDRIG_VERSION}.tar.gz

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ocl-icd-libopencl1 procps tar \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/wildrig \
  && curl -fsSL "$WILDRIG_URL" -o /tmp/wildrig.tar.gz \
  && tar -xzf /tmp/wildrig.tar.gz -C /opt/wildrig \
  && chmod +x /opt/wildrig/wildrig-multi \
  && rm /tmp/wildrig.tar.gz

COPY entrypoint.sh /usr/local/bin/prl-burnin-entrypoint
RUN chmod +x /usr/local/bin/prl-burnin-entrypoint

ENTRYPOINT ["/usr/local/bin/prl-burnin-entrypoint"]
