.PHONY: setup up down logs dev test help

help:
	@echo "ClaimArbiter — quick commands for judges"
	@echo ""
	@echo "  make setup   Copy .env and agent_config templates (once)"
	@echo "  make up      Build and start gateway + dashboard (Docker)"
	@echo "  make logs    Follow Docker service logs"
	@echo "  make down    Stop Docker services"
	@echo "  make dev     Print local (no-Docker) run instructions"
	@echo "  make test    Run backend unit tests"
	@echo ""
	@echo "After setup, fill in .env and agent_config.yaml — see SETUP.md"

setup:
	@test -f .env || cp .env.example .env
	@test -f agent_config.yaml || cp agent_config.example.yaml agent_config.yaml
	@echo "Templates ready. Edit .env and agent_config.yaml, then: make up"

up:
	python3 scripts/up.py up

logs:
	docker compose logs -f

down:
	docker compose down

dev:
	@echo "Run these in three separate terminals (after make setup):"
	@echo ""
	@echo "  cd backend && uv sync && uv run python agents/run_all.py"
	@echo "  cd backend && uv run python gateway/main.py"
	@echo "  cd frontend && cp .env.local.example .env.local && npm install && npm run dev"
	@echo ""
	@echo "Open http://localhost:3000 — live console at http://localhost:3000/app/live"

test:
	cd backend && uv sync && uv run python -m unittest discover -s tests
