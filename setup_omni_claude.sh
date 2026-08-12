#!/bin/bash
set -e

echo "📦 Installing OmniRoute and Claude Code..."
npm install -g omniroute @anthropic-ai/claude-code

echo "⚙️ Configuring Claude Code proxy settings..."
mkdir -p ~/.claude/profiles
cat << 'JSON' > ~/.claude/profiles/default.json
{
  "api_url": "http://localhost:20128/v1"
}
JSON

echo "🚀 Starting OmniRoute gateway..."
# Starts omniroute in the background so the script can continue
omniroute & 

echo "🎉 Setup complete! OmniRoute is running in the background."
echo "👉 Run 'claude' to start your session."
