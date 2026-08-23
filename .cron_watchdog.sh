#!/bin/bash
# ═════════════════════════════════════════════════════════════════
# infinity-ai CRON WATCHDOG — Safety net for the safety net
# ═════════════════════════════════════════════════════════════════
# This runs every 5 minutes via cron.
# If .session_state.md has pending work AND nothing is running,
# it auto-starts infinity-ai-launch.sh.
# ═════════════════════════════════════════════════════════════════

# cron has a minimal PATH — add everything we might need
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin"
export HOME="/home/kasperkal1970"

PROJECT_DIR="/home/kasperkal1970/infinity-ai"
STATE_FILE="$PROJECT_DIR/.session_state.md"
LAUNCHER="$PROJECT_DIR/infinity-ai-launch.sh"
LOG_FILE="$PROJECT_DIR/.launch.log"

# ── Bail if state file doesn't exist ──
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# ── Check if all steps are done ──
INCOMPLETE=$(grep -c '\[ \]' "$STATE_FILE" 2>/dev/null || echo 0)
if [ "$INCOMPLETE" -eq 0 ]; then
  # All done — nothing to do
  exit 0
fi

# ── Check if anything is already running ──
if tmux has-session -t infinity-ai 2>/dev/null; then
  exit 0  # Already running
fi

if pgrep -f "claude" > /dev/null 2>&1; then
  exit 0  # Claude already running (no tmux?)
fi

# ── Nothing running but work pending — launch! ──
echo "$(date) — ⏰ Cron watchdog: work pending, launching..." >> "$LOG_FILE"
cd "$PROJECT_DIR" && bash "$LAUNCHER" &
