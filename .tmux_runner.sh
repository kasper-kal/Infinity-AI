#!/bin/bash
# ═════════════════════════════════════════════════════════════════
# tmux runner — runs inside the tmux session, keeps Claude alive
# ═════════════════════════════════════════════════════════════════
# This script runs INSIDE the tmux pane.
# It launches Claude Code in an endless loop.
# When Claude crashes/exits, it just restarts.
# The infinity-ai-launch.sh script handles sending "omniroute" and "go".
# ═════════════════════════════════════════════════════════════════

LOG_FILE="/home/kasperkal1970/infinity-ai/.launch.log"
PROJECT_DIR="/home/kasperkal1970/infinity-ai"

echo "$(date) — 🚀 tmux runner started" >> "$LOG_FILE"
cd "$PROJECT_DIR" || exit 1

MAX_ATTEMPTS=9999
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "$(date) — Spawn attempt $ATTEMPT" >> "$LOG_FILE"

  # Clear any leftover partial input
  stty sane 2>/dev/null

  # Launch Claude Code
  # It reads CLAUDE.md → which tells it to read .session_state.md first
  claude

  # If claude exits or crashes, log and restart
  EXIT_CODE=$?
  echo "$(date) — Claude exited ($EXIT_CODE), restarting in 3s..." >> "$LOG_FILE"
  sleep 3
done
