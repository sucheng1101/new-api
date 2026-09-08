SHELL := /bin/sh
.DEFAULT_GOAL := start

ROOT_DIR := $(CURDIR)
FRONTEND_DIR := $(ROOT_DIR)/web
BACKEND_DIR := $(ROOT_DIR)
GIT_DIR := $(shell git rev-parse --git-dir 2>/dev/null || printf '.git')
RUNTIME_DIR ?= $(abspath $(GIT_DIR))/new-api-dev
DB_COMPOSE_FILE ?= $(ROOT_DIR)/docker-compose.local.yml

BACKEND_PORT ?= 3000
FRONTEND_PORT ?= 5173
VITE_PROXY_TARGET ?= http://127.0.0.1:$(BACKEND_PORT)
BACKEND_SQL_DSN ?=
BACKEND_SQLITE_PATH ?= $(RUNTIME_DIR)/new-api.db
BACKEND_REDIS_CONN_STRING ?=
BACKEND_HEALTH_URL ?= http://127.0.0.1:$(BACKEND_PORT)/api/status
FRONTEND_HEALTH_URL ?= http://127.0.0.1:$(FRONTEND_PORT)/
START_TIMEOUT ?= 30
STOP_TIMEOUT ?= 10
STATUS_TIMEOUT ?= 3
LOG_LINES ?= 100

BACKEND_BIN := $(RUNTIME_DIR)/new-api
BACKEND_PID := $(RUNTIME_DIR)/backend.pid
FRONTEND_PID := $(RUNTIME_DIR)/frontend.pid
BACKEND_LOG := $(RUNTIME_DIR)/backend.log
FRONTEND_LOG := $(RUNTIME_DIR)/frontend.log

.PHONY: all dev start restart stop status logs logs-follow help prepare \
	check-backend-tools check-frontend-tools check-process-tools check-docker-tools \
	install-frontend \
	build build-backend build-frontend start-backend start-frontend

all: start

dev: start

local: start

check-docker-tools:
	@set -eu; \
	command -v docker >/dev/null 2>&1 || { echo "Missing required tool: docker" >&2; exit 1; }; \
	docker compose version >/dev/null 2>&1 || { echo "Docker Compose is not available" >&2; exit 1; }; \
	docker info >/dev/null 2>&1 || { echo "Docker daemon is not available" >&2; exit 1; }

help:
	@printf '%s\n' \
		'make / make start       Start backend and frontend' \
		'make stop               Stop processes started by this Makefile' \
		'make restart            Restart backend and frontend' \
		'make status             Show process and health status' \
		'make logs               Show recent backend and frontend logs' \
		'make logs-follow        Follow backend and frontend logs' \
		'make build              Build backend binary and frontend assets' \
		'make local              Start the Docker-backed local stack' \
		'make BACKEND_PORT=3102 FRONTEND_PORT=5178 start'

prepare:
	@mkdir -p "$(RUNTIME_DIR)"

check-backend-tools:
	@set -eu; \
	for tool in go curl lsof ps; do \
		command -v "$$tool" >/dev/null 2>&1 || { echo "Missing required tool: $$tool" >&2; exit 1; }; \
	done

check-frontend-tools:
	@set -eu; \
	for tool in bun curl lsof ps; do \
		command -v "$$tool" >/dev/null 2>&1 || { echo "Missing required tool: $$tool" >&2; exit 1; }; \
	done

check-process-tools:
	@set -eu; \
	for tool in curl lsof pgrep ps; do \
		command -v "$$tool" >/dev/null 2>&1 || { echo "Missing required tool: $$tool" >&2; exit 1; }; \
	done

install-frontend: check-frontend-tools
	@echo "Installing frontend dependencies..."
	@cd "$(FRONTEND_DIR)" && bun install

start-databases: check-docker-tools prepare
	@set -eu; \
	docker compose -f "$(DB_COMPOSE_FILE)" up -d mysql redis; \
	i=0; \
	while [ "$$i" -lt 60 ]; do \
		if docker compose -f "$(DB_COMPOSE_FILE)" exec -T mysql mysqladmin ping -h 127.0.0.1 -uroot -p123456 --silent >/dev/null 2>&1 && \
		   docker compose -f "$(DB_COMPOSE_FILE)" exec -T redis redis-cli ping >/dev/null 2>&1; then \
			docker compose -f "$(DB_COMPOSE_FILE)" exec -T mysql mysql -uroot -p123456 -e 'CREATE DATABASE IF NOT EXISTS `new-api-local-dev` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'; \
			echo "Database containers ready."; exit 0; \
		fi; \
		sleep 1; i=$$((i + 1)); \
	done; \
	echo "Database containers did not become healthy. Check docker compose logs." >&2; exit 1

build: build-backend build-frontend

build-backend: check-backend-tools prepare
	@echo "Building backend..."
	@cd "$(BACKEND_DIR)" && go build -o "$(BACKEND_BIN)" .

build-frontend: check-frontend-tools
	@echo "Building frontend..."
	@cd "$(FRONTEND_DIR)" && bun install && \
		DISABLE_ESLINT_PLUGIN='true' \
		VITE_REACT_APP_VERSION="$$(cat "$(ROOT_DIR)/VERSION")" \
		bun run build

start: start-databases start-backend start-frontend status

start-backend: check-backend-tools prepare
	@set -eu; \
	if [ -f "$(BACKEND_PID)" ]; then \
		pid=$$(cat "$(BACKEND_PID)" 2>/dev/null || true); \
		case "$$pid" in ''|*[!0-9]*) owned=0 ;; \
			*) cwd=$$(lsof -a -p "$$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true); \
			   command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
			   if kill -0 "$$pid" 2>/dev/null && [ "$$cwd" = "$(BACKEND_DIR)" ]; then \
				   case "$$command" in *"$(BACKEND_BIN)"*) owned=1 ;; *) owned=0 ;; esac; \
			   else owned=0; fi ;; \
		esac; \
		if [ "$$owned" -eq 1 ]; then echo "Backend already running (PID $$pid)."; exit 0; fi; \
		echo "Removing stale backend PID file."; rm -f "$(BACKEND_PID)"; \
	fi; \
	if lsof -nP -iTCP:$(BACKEND_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Backend port $(BACKEND_PORT) is already in use:" >&2; \
		lsof -nP -iTCP:$(BACKEND_PORT) -sTCP:LISTEN >&2; exit 1; \
	fi; \
	echo "Building backend..."; \
	cd "$(BACKEND_DIR)" && go build -o "$(BACKEND_BIN)" .; \
	echo "Starting backend on http://127.0.0.1:$(BACKEND_PORT)..."; \
	nohup sh -c 'cd "$$1" || exit 1; \
		export PORT="$$2"; \
		if [ -n "$$3" ]; then export SQL_DSN="$$3"; fi; \
		if [ -n "$$4" ]; then export SQLITE_PATH="$$4"; fi; \
		if [ -n "$$5" ]; then export REDIS_CONN_STRING="$$5"; fi; \
		exec "$$6"' new-api \
		"$(BACKEND_DIR)" "$(BACKEND_PORT)" "$(BACKEND_SQL_DSN)" "$(BACKEND_SQLITE_PATH)" "$(BACKEND_REDIS_CONN_STRING)" "$(BACKEND_BIN)" \
		>"$(BACKEND_LOG)" 2>&1 & \
	pid=$$!; echo "$$pid" >"$(BACKEND_PID)"; \
	i=0; \
	while [ "$$i" -lt "$(START_TIMEOUT)" ]; do \
		if ! kill -0 "$$pid" 2>/dev/null; then break; fi; \
		if curl -fsS --max-time 1 "$(BACKEND_HEALTH_URL)" >/dev/null 2>&1; then \
			echo "Backend ready (PID $$pid)."; exit 0; \
		fi; \
		sleep 1; i=$$((i + 1)); \
	done; \
	if kill -0 "$$pid" 2>/dev/null; then kill -TERM "$$pid" 2>/dev/null || true; fi; \
	rm -f "$(BACKEND_PID)"; \
	echo "Backend did not become healthy. See $(BACKEND_LOG)" >&2; exit 1

start-frontend: check-frontend-tools prepare
	@set -eu; \
	if [ -f "$(FRONTEND_PID)" ]; then \
		pid=$$(cat "$(FRONTEND_PID)" 2>/dev/null || true); \
		case "$$pid" in ''|*[!0-9]*) owned=0 ;; \
			*) cwd=$$(lsof -a -p "$$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true); \
			   command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
			   if kill -0 "$$pid" 2>/dev/null && [ "$$cwd" = "$(FRONTEND_DIR)" ]; then \
				   case "$$command" in *bun*|*vite*) owned=1 ;; *) owned=0 ;; esac; \
			   else owned=0; fi ;; \
		esac; \
		if [ "$$owned" -eq 1 ]; then echo "Frontend already running (PID $$pid)."; exit 0; fi; \
		echo "Removing stale frontend PID file."; rm -f "$(FRONTEND_PID)"; \
	fi; \
	if lsof -nP -iTCP:$(FRONTEND_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Frontend port $(FRONTEND_PORT) is already in use:" >&2; \
		lsof -nP -iTCP:$(FRONTEND_PORT) -sTCP:LISTEN >&2; exit 1; \
	fi; \
	if [ ! -d "$(FRONTEND_DIR)/node_modules" ]; then \
		echo "Installing frontend dependencies..."; \
		cd "$(FRONTEND_DIR)" && bun install; \
	fi; \
	version=$$(cat "$(ROOT_DIR)/VERSION"); \
	echo "Starting frontend on http://127.0.0.1:$(FRONTEND_PORT)..."; \
	nohup sh -c 'cd "$$1" && exec env VITE_PROXY_TARGET="$$2" VITE_REACT_APP_VERSION="$$3" bun run dev -- --host 0.0.0.0 --port "$$4" --strictPort' new-api \
		"$(FRONTEND_DIR)" "$(VITE_PROXY_TARGET)" "$$version" "$(FRONTEND_PORT)" \
		>"$(FRONTEND_LOG)" 2>&1 & \
	pid=$$!; echo "$$pid" >"$(FRONTEND_PID)"; \
	i=0; \
	while [ "$$i" -lt "$(START_TIMEOUT)" ]; do \
		if ! kill -0 "$$pid" 2>/dev/null; then break; fi; \
		if curl -fsS --max-time 1 "$(FRONTEND_HEALTH_URL)" >/dev/null 2>&1; then \
			echo "Frontend ready (PID $$pid)."; exit 0; \
		fi; \
		sleep 1; i=$$((i + 1)); \
	done; \
	if kill -0 "$$pid" 2>/dev/null; then kill -TERM "$$pid" 2>/dev/null || true; fi; \
	rm -f "$(FRONTEND_PID)"; \
	echo "Frontend did not become healthy. See $(FRONTEND_LOG)" >&2; exit 1

restart:
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

stop-databases: check-docker-tools prepare
	@docker compose -f "$(DB_COMPOSE_FILE)" stop mysql redis >/dev/null 2>&1 || true

stop: check-process-tools check-docker-tools prepare
	@set -eu; \
	descendants() { \
		for child in $$(pgrep -P "$$1" 2>/dev/null || true); do descendants "$$child"; echo "$$child"; done; \
	}; \
	stop_one() { \
		label="$$1"; pid_file="$$2"; expected_cwd="$$3"; kind="$$4"; \
		if [ ! -f "$$pid_file" ]; then echo "$$label is not running."; return 0; fi; \
		pid=$$(cat "$$pid_file" 2>/dev/null || true); \
		case "$$pid" in ''|*[!0-9]*) echo "Removing invalid $$label PID file."; rm -f "$$pid_file"; return 0 ;; esac; \
		if ! kill -0 "$$pid" 2>/dev/null; then echo "Removing stale $$label PID file."; rm -f "$$pid_file"; return 0; fi; \
		cwd=$$(lsof -a -p "$$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		owned=0; \
		if [ "$$cwd" = "$$expected_cwd" ]; then \
			case "$$kind:$$command" in backend:*"$(BACKEND_BIN)"*|frontend:*bun*|frontend:*vite*) owned=1 ;; esac; \
		fi; \
		if [ "$$owned" -ne 1 ]; then echo "Skipping $$label: PID ownership does not match this checkout." >&2; return 1; fi; \
		pids="$$(descendants "$$pid") $$pid"; \
		if [ "$$kind" = frontend ]; then signal=INT; else signal=TERM; fi; \
		kill -"$$signal" $$pids 2>/dev/null || true; \
		i=0; \
		while [ "$$i" -lt "$(STOP_TIMEOUT)" ]; do \
			alive=0; \
			for process_id in $$pids; do \
				state=$$(ps -p "$$process_id" -o stat= 2>/dev/null | tr -d ' ' || true); \
				case "$$state" in ''|Z*) ;; *) alive=1 ;; esac; \
			done; \
			[ "$$alive" -eq 0 ] && break; \
			sleep 1; i=$$((i + 1)); \
		done; \
		for process_id in $$pids; do \
			state=$$(ps -p "$$process_id" -o stat= 2>/dev/null | tr -d ' ' || true); \
			case "$$state" in ''|Z*) ;; *) kill -KILL "$$process_id" 2>/dev/null || true ;; esac; \
		done; \
		rm -f "$$pid_file"; echo "$$label stopped."; \
	}; \
	rc=0; \
	stop_one Backend "$(BACKEND_PID)" "$(BACKEND_DIR)" backend || rc=1; \
	stop_one Frontend "$(FRONTEND_PID)" "$(FRONTEND_DIR)" frontend || rc=1; \
	$(MAKE) --no-print-directory stop-databases >/dev/null 2>&1 || rc=1; \
	exit "$$rc"

status-databases: check-docker-tools prepare
	@docker compose -f "$(DB_COMPOSE_FILE)" ps mysql redis

status: check-process-tools check-docker-tools prepare
	@$(MAKE) --no-print-directory status-databases
	@set -eu; \
	status_one() { \
		label="$$1"; pid_file="$$2"; expected_cwd="$$3"; kind="$$4"; port="$$5"; url="$$6"; \
		if [ ! -f "$$pid_file" ]; then echo "$$label: stopped"; return 0; fi; \
		pid=$$(cat "$$pid_file" 2>/dev/null || true); \
		case "$$pid" in ''|*[!0-9]*) echo "$$label: stale PID file"; return 0 ;; esac; \
		cwd=$$(lsof -a -p "$$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true); \
		command=$$(ps -p "$$pid" -o command= 2>/dev/null || true); \
		owned=0; \
		if kill -0 "$$pid" 2>/dev/null && [ "$$cwd" = "$$expected_cwd" ]; then \
			case "$$kind:$$command" in backend:*"$(BACKEND_BIN)"*|frontend:*bun*|frontend:*vite*) owned=1 ;; esac; \
		fi; \
		if [ "$$owned" -ne 1 ]; then echo "$$label: stale or ownership mismatch (PID $$pid)"; return 0; fi; \
		if curl -fsS --max-time "$(STATUS_TIMEOUT)" "$$url" >/dev/null 2>&1; then health=healthy; else health=unhealthy; fi; \
		echo "$$label: running, $$health (PID $$pid, port $$port)"; \
	}; \
	status_one Backend "$(BACKEND_PID)" "$(BACKEND_DIR)" backend "$(BACKEND_PORT)" "$(BACKEND_HEALTH_URL)"; \
	status_one Frontend "$(FRONTEND_PID)" "$(FRONTEND_DIR)" frontend "$(FRONTEND_PORT)" "$(FRONTEND_HEALTH_URL)"

logs: prepare
	@set -eu; \
	for entry in "Backend:$(BACKEND_LOG)" "Frontend:$(FRONTEND_LOG)"; do \
		label=$${entry%%:*}; file=$${entry#*:}; \
		echo "===== $$label ====="; \
		if [ -f "$$file" ]; then tail -n "$(LOG_LINES)" "$$file"; else echo "No log file yet."; fi; \
	done

logs-follow: prepare
	@touch "$(BACKEND_LOG)" "$(FRONTEND_LOG)"
	@tail -F "$(BACKEND_LOG)" "$(FRONTEND_LOG)"
