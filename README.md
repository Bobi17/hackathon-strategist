# Hackathon Strategist ⚡

A multi-agent research & ideation system designed to help hackathon teams determine **what to build to win**.

The system automates the event ingestion, research, deliberation, and ideation pipeline, ensuring that every design decision is backed by cited evidence from event sponsors, judges, past winners, and provided datasets.

---

## 🏗️ Architecture Overview

The Strategist uses a stage-based orchestration engine to drive a panel of 12 specialist personas through an iterative deliberation loop.

- **Ingestion Layer:** Handles HTML/CSV/JSON ingestion, with browser-based escalation for login-walled or JS-rendered pages.
- **Orchestration Engine:** Manages the stage machine, budget governor, and event bus, ensuring deliberative rounds adhere to time/cost constraints.
- **Agent Panel:** 12 persona-driven agents perform research, innovation, and critical review.
- **Control Room:** A reactive UI (WebSocket-based) allowing human operators to monitor transcripts, interject directives, and resolve critical gates live.

---

## 🚀 Setup & Execution

### Prerequisites
- Node.js ≥ 22.12
- pnpm

### Option 1: Local Setup
1. `pnpm install`
2. `cp .env.example .env.local` — Configure one LLM provider (API Key, URL, Model).
3. Prepare event config: `cp config/events/example.json config/events/my-event/event.json`
4. Run: `pnpm strategist:run -c config/events/my-event/event.json`

### Option 2: Docker Setup (Recommended)
Isolated, secure, and production-ready environment.

1. Build: `docker compose build`
2. Run: `docker compose run --rm strategist pnpm strategist:run -c config/events/my-event/event.json`

See `docker-compose.yml` and `Dockerfile` for network/resource constraints.

---

## 📖 Key Resources
- **[Product Spec](spec.md)** — Project goals and requirements.
- **[Implementation Plan](IMPLEMENTATION_PLAN.md)** — Detailed engineering design.
- **[Agent Roster](AGENTS.md)** — Persona charters and tool definitions.
- **[Decision Rubric](RUBRIC.md)** — Weighted scoring criteria used by the Judge.
- **[Handoff Ledger](HANDOFF.md)** — Session coordination for parallel agents.

---
*For internal use only.*