#!/usr/bin/env python3
"""Cross-platform `make up` — build, start, wait for health, print a clean banner.

Works on Windows / macOS / Linux (no `make` or POSIX shell required), as long as
Docker Desktop (or the docker engine) and Python 3 are installed.

Usage, from the repo root:
    python scripts/up.py          # build + start, wait for health, print URLs
    python scripts/up.py down     # stop services
    python scripts/up.py logs     # follow container logs
"""

from __future__ import annotations

import subprocess
import sys
import time

# docker compose v2 ("docker compose") is what ships with modern Docker Desktop.
COMPOSE = ["docker", "compose"]
POLL_SECONDS = 2
TIMEOUT_SECONDS = 300  # ~5 min covers a cold image build + healthcheck start_period


def _run(args: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(COMPOSE + args, capture_output=capture, text=True)


def _gateway_field(field: str) -> str:
    """Return e.g. the gateway's Health ('healthy') or State ('running'/'exited')."""
    result = _run(["ps", "gateway", "--format", "{{." + field + "}}"], capture=True)
    return (result.stdout or "").strip()


def up() -> int:
    print("Building and starting services...")
    build = _run(["up", "--build", "-d"])
    if build.returncode != 0:
        return build.returncode

    print("Waiting for the gateway to become healthy...")
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while True:
        if _gateway_field("Health") == "healthy":
            break
        if _gateway_field("State") == "exited":
            print("Gateway exited unexpectedly. Run 'python scripts/up.py logs' to see why.")
            return 1
        if time.monotonic() > deadline:
            print("Timed out waiting for the gateway. Run 'python scripts/up.py logs' to see why.")
            return 1
        time.sleep(POLL_SECONDS)

    print()
    print("  ✅ ClaimArbiter is running")
    print()
    print("  Dashboard      http://localhost:3000")
    print("  Live console   http://localhost:3000/app/live")
    print("  Gateway API    http://localhost:8080/api/state")
    print()
    print("  python scripts/up.py logs   Follow container logs")
    print("  python scripts/up.py down   Stop services")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "up"
    if cmd == "up":
        return up()
    if cmd == "down":
        return _run(["down"]).returncode
    if cmd == "logs":
        return _run(["logs", "-f"]).returncode
    print(f"Unknown command: {cmd!r}. Use one of: up, down, logs.")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
