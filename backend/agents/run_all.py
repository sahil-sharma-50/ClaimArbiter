"""Launch all ARBITER agents in parallel subprocesses."""

from __future__ import annotations

import logging
import multiprocessing as mp
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arbiter.run_all")


def _run(module: str) -> None:
    import asyncio
    import importlib

    mod = importlib.import_module(module)
    asyncio.run(mod.main())


# (label, module, credential_name). The credential_name is the readiness-marker
# key each agent writes once its Band WebSocket connects; the gateway supervisor
# polls for exactly this set. Keep it in sync with each agent's AgentSpec.
AGENTS = [
    ("Intake & Coverage", "agents.insurer.intake_coverage", "intake_coverage"),
    ("Evidence Analyst", "agents.insurer.evidence_analyst", "evidence_analyst"),
    ("Case Coordinator", "agents.insurer.case_coordinator", "case_coordinator"),
    ("Property Assessment", "agents.investigation.property_agent", "property_agent"),
    ("Medical Review", "agents.investigation.medical_agent", "medical_agent"),
    ("Legal Review", "agents.investigation.legal_agent", "legal_agent"),
]

# The readiness-marker names the gateway waits on (see gateway.agent_runner).
AGENT_READY_NAMES = tuple(cred for _, _, cred in AGENTS)


def main() -> None:
    processes: list[mp.Process] = []
    for label, module, _cred in AGENTS:
        proc = mp.Process(target=_run, args=(module,), name=label, daemon=False)
        proc.start()
        processes.append(proc)
        logger.info("Started %s (pid=%s)", label, proc.pid)

    try:
        for proc in processes:
            proc.join()
    except KeyboardInterrupt:
        logger.info("Shutting down agents...")
        for proc in processes:
            proc.terminate()
        for proc in processes:
            proc.join(timeout=5)


if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    main()
