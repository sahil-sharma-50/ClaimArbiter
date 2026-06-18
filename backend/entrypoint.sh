#!/bin/sh
# Container entrypoint for the ClaimArbiter gateway.
#
# Render mounts Secret Files at /etc/secrets/<filename> (path not configurable),
# but the gateway reads ./agent_config.yaml from its workdir (/app). So if the
# Band agent config was provided as a Render Secret File, copy it into place
# before launching. When agent_config.yaml is already in /app (local docker /
# compose, where it's bind-mounted or COPYed), the source won't exist and we
# simply skip the copy.
#
# This lives in a script — not render.yaml's dockerCommand — because Render execs
# dockerCommand directly (no shell), so `&&` and `cp ... && uv run ...` do not work
# there. A real shell script is portable across hosts.
set -e

if [ -f /etc/secrets/agent_config.yaml ] && [ ! -f /app/agent_config.yaml ]; then
  cp /etc/secrets/agent_config.yaml /app/agent_config.yaml
fi

exec uv run python gateway/main.py
