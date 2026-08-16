# Infinity AI — Headless CI/CD Mode

Run Infinity AI builds non-interactively in CI/CD pipelines (GitHub Actions, GitLab CI, CircleCI, etc.) with proper exit codes and JSON output.

## Quick Start

### 1. Install the CLI

```bash
# From source
git clone https://github.com/kasper-kal/Infinity-AI.git
cd Infinity-AI/artifacts/cli
npm install
npm run build

# Add to PATH
export PATH="$PATH:$(pwd)/dist"
```

### 2. Create an API Key

1. Open Infinity AI in your browser
2. Go to **Settings → API Keys**
3. Click **Create API Key**
4. Name it (e.g., "CI/CD Pipeline")
5. Select scopes: `build:read`, `build:write`, `project:read`
6. **Copy the key immediately** — it won't be shown again

### 3. Configure Environment

```bash
# Required
export INFINITY_API_KEY="inf_xxxxxxxxxxxxxxxx"

# Optional (defaults shown)
export INFINITY_API_URL="https://api.infinity.local"  # or your self-hosted URL
export INFINITY_PROJECT_ID="default"
```

### 4. Run a Headless Build

```bash
# Simple scaffold build
infinity build --headless --json --prompt "Build a React todo app with TypeScript"

# Iterate on existing project with a plan
infinity build --headless --json --prompt "Add user authentication" --plan '{"title":"Auth","steps":[...]}'

# With all options
infinity build \
  --headless \
  --json \
  --api-key "$INFINITY_API_KEY" \
  --base-url "$INFINITY_API_URL" \
  --project-id "my-project" \
  --workspace-id "my-project" \
  --prompt "Build a dashboard with charts" \
  --max-iterations 20 \
  --temperature 0.2 \
  --output build-result.json \
  --exit-on-failure
```

## Exit Codes

| Code | Name | Description |
|------|------|-------------|
| `0` | `SUCCESS` | Build completed successfully |
| `1` | `BUILD_FAILED` | Build ran but failed (agent stopped, errors) |
| `2` | `VALIDATION_ERROR` | Invalid request (400 - bad prompt, missing params) |
| `3` | `BUDGET_EXCEEDED` | Rate limited or budget exceeded (429) |
| `4` | `TIMEOUT` | Conflict or timeout (409 - pre-flight failed, queue full) |

Use in CI:
```bash
infinity build --headless --json --prompt "..." --exit-on-failure
echo "Exit code: $?"
# 0 = success, non-zero = failure
```

## JSON Output

### Standard Mode (`--json`)

Outputs a single JSON object at the end:

```json
{
  "success": true,
  "projectId": "default",
  "summary": "Created React todo app with components, hooks, and styles",
  "iterations": 8,
  "toolCalls": 23,
  "toolResults": [...],
  "timestamp": "2026-01-15T10:30:45.123Z"
}
```

### Streaming Mode (`--headless --json`)

Outputs **JSONL (newline-delimited JSON)** events in real-time for pipeline parsing:

```json
{"type":"build.started","timestamp":"2026-01-15T10:30:00.000Z","projectId":"default","buildId":"build_abc123","data":{"prompt":"Build a React todo app","options":{"maxIterations":20},"eventCount":0}}
{"type":"build.progress","timestamp":"2026-01-15T10:30:01.000Z","projectId":"default","buildId":"build_abc123","data":{"message":"Initializing workspace","progress":0,"eventCount":1}}
{"type":"build.iteration_start","timestamp":"2026-01-15T10:30:02.000Z","projectId":"default","buildId":"build_abc123","data":{"iteration":1,"goal":"Create project structure","eventCount":2}}
{"type":"build.tool_call","timestamp":"2026-01-15T10:30:03.000Z","projectId":"default","buildId":"build_abc123","data":{"toolName":"write_file","args":{"path":"package.json",...},"callId":"call_1","eventCount":3}}
{"type":"build.tool_result","timestamp":"2026-01-15T10:30:04.000Z","projectId":"default","buildId":"build_abc123","data":{"callId":"call_1","success":true,"result":"File written","eventCount":4}}
{"type":"build.iteration_complete","timestamp":"2026-01-15T10:30:05.000Z","projectId":"default","buildId":"build_abc123","data":{"iteration":1,"summary":"Created package.json and tsconfig","toolCalls":2,"toolResults":2,"eventCount":5}}
{"type":"build.completed","timestamp":"2026-01-15T10:35:00.000Z","projectId":"default","buildId":"build_abc123","data":{"summary":"Created React todo app","iterations":8,"toolCalls":23,"toolResults":23,"durationMs":300000,"filesCreated":15,"filesModified":3,"eventCount":42}}
```

### Event Types

| Event | When | Key Data |
|-------|------|----------|
| `build.started` | Build begins | `prompt`, `options` |
| `build.progress` | Status update | `message`, `progress` (0-100) |
| `build.iteration_start` | Agent iteration starts | `iteration`, `goal` |
| `build.iteration_complete` | Iteration done | `iteration`, `summary`, `toolCalls`, `toolResults` |
| `build.tool_call` | Tool invoked | `toolName`, `args`, `callId` |
| `build.tool_result` | Tool returned | `callId`, `success`, `result`, `error` |
| `build.error` | Error occurred | `message`, `error`, `stack` |
| `build.warning` | Warning | `message` |
| `build.budget_warning` | Budget at 80%+ | `percentUsed`, `limit`, `current` |
| `build.budget_exceeded` | Budget exceeded | `limit`, `current` |
| `build.checkpoint_created` | Checkpoint saved | `checkpointId`, `label` |
| `build.snapshot_created` | Snapshot saved | `snapshotId`, `label` |
| `build.completed` | Success | `summary`, `iterations`, `toolCalls`, `durationMs`, `filesCreated` |
| `build.failed` | Failed | `summary`, `error`, `iterations`, `toolCalls`, `durationMs` |
| `build.cancelled` | Cancelled | `reason`, `iterations`, `toolCalls`, `durationMs` |

### Consuming JSONL in Pipelines

**Bash/JQ:**
```bash
infinity build --headless --json --prompt "..." | while IFS= read -r line; do
  event=$(echo "$line" | jq -r '.type')
  case "$event" in
    "build.completed")
      echo "✅ Build succeeded!"
      ;;
    "build.failed")
      echo "❌ Build failed: $(echo "$line" | jq -r '.data.error')"
      ;;
    "build.tool_call")
      echo "🔧 $(echo "$line" | jq -r '.data.toolName')"
      ;;
  esac
done
```

**Python:**
```python
import json
import subprocess

proc = subprocess.Popen(
    ["infinity", "build", "--headless", "--json", "--prompt", "..."],
    stdout=subprocess.PIPE,
    text=True
)

for line in proc.stdout:
    event = json.loads(line)
    if event["type"] == "build.completed":
        print(f"Success: {event['data']['summary']}")
    elif event["type"] == "build.failed":
        print(f"Failed: {event['data']['error']}")
        exit(1)

proc.wait()
```

## GitHub Actions

### Basic Workflow

Create `.github/workflows/infinity-build.yml`:

```yaml
name: Infinity AI Build

on:
  workflow_dispatch:
    inputs:
      prompt:
        description: "Build prompt"
        required: true
        type: string
      project_id:
        description: "Project ID"
        required: false
        type: string
        default: "default"

env:
  INFINITY_API_URL: ${{ secrets.INFINITY_API_URL }}
  INFINITY_API_KEY: ${{ secrets.INFINITY_API_KEY }}

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Infinity CLI
        run: |
          cd artifacts/cli
          npm ci
          npm run build
          echo "$(pwd)/dist" >> $GITHUB_PATH

      - name: Run Headless Build
        id: build
        run: |
          infinity build \
            --headless \
            --json \
            --project-id "${{ github.event.inputs.project_id }}" \
            --prompt "${{ github.event.inputs.prompt }}" \
            --output build-result.json \
            --exit-on-failure

      - name: Upload Build Result
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: infinity-build-result
          path: artifacts/cli/build-result.json

      - name: Build Summary
        if: always()
        run: |
          cat artifacts/cli/build-result.json | jq '.'
```

### Reusable Workflow

Call from another repository:

```yaml
# .github/workflows/build.yml
name: Build with Infinity

on:
  workflow_dispatch:
    inputs:
      prompt:
        required: true
        type: string

jobs:
  infinity-build:
    uses: kasper-kal/Infinity-AI/.github/workflows/infinity-build.yml@main
    secrets:
      INFINITY_API_KEY: ${{ secrets.INFINITY_API_KEY }}
    with:
      prompt: ${{ github.event.inputs.prompt }}
      project_id: "my-project"
```

## GitLab CI

```yaml
# .gitlab-ci.yml
infinity_build:
  image: node:20
  stage: build
  variables:
    INFINITY_API_URL: $INFINITY_API_URL
    INFINITY_API_KEY: $INFINITY_API_KEY
  before_script:
    - cd artifacts/cli
    - npm ci
    - npm run build
    - export PATH="$PATH:$(pwd)/dist"
  script:
    - infinity build --headless --json --prompt "Build a React app" --exit-on-failure
  artifacts:
    reports:
      dotenv: build-result.json
    when: always
    expire_in: 1 week
```

## CircleCI

```yaml
# .circleci/config.yml
version: 2.1
jobs:
  infinity-build:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Install Infinity CLI
          command: |
            cd artifacts/cli
            npm ci
            npm run build
            echo 'export PATH="$PATH:$(pwd)/dist"' >> $BASH_ENV
      - run:
          name: Run Headless Build
          command: |
            infinity build --headless --json --prompt "Build a React app" --exit-on-failure
workflows:
  build:
    jobs:
      - infinity-build
```

## Configuration Options

| Flag | Env Var | Description |
|------|---------|-------------|
| `--api-key` | `INFINITY_API_KEY` | API key for authentication |
| `--base-url` | `INFINITY_API_URL` | API server URL |
| `--project-id` | `INFINITY_PROJECT_ID` | Project ID (default: "default") |
| `--workspace-id` | `INFINITY_WORKSPACE_ID` | Workspace ID (default: project-id) |
| `--headless` | - | Enable headless mode (JSONL streaming) |
| `--json` | - | Output JSON (single object at end) |
| `--prompt` | - | Build prompt/goal (required) |
| `--plan` | - | JSON plan string for scaffold |
| `--max-iterations` | - | Max agent iterations (1-30, default: 20) |
| `--temperature` | - | LLM temperature 0-1 (default: 0.2) |
| `--preview-port` | - | Preview server port |
| `--skip-preflight` | - | Skip pre-flight checks |
| `--dry-run` | - | Plan only, no execution |
| `--extra-system-prompt` | - | Additional system instructions |
| `--output` | - | Write final JSON to file |
| `--exit-on-failure` / `--no-exit-on-failure` | - | Exit with error code on failure (default: true) |

## Complete CLI Reference

```bash
# Build commands
infinity build --headless --json --prompt "..." [options]
infinity plan --prompt "..." [options]           # Create plan only
infinity ask --prompt "..."                      # Analyze request

# Management commands
infinity status                                  # Get build status
infinity checkpoint list|create|restore|delete   # Manage checkpoints
infinity budget status|set                       # Manage budgets
infinity snapshot list|create|restore|delete     # Manage snapshots
infinity config                                  # Show configuration

# Global options (all commands)
-k, --api-key <key>       API key
-u, --base-url <url>      API base URL
-p, --project-id <id>     Project ID
--headless                Headless mode
--json                    JSON output
-v, --verbose             Verbose output
```

## Troubleshooting

### "API key required"
- Ensure `INFINITY_API_KEY` is set
- Verify the key has `build:write` scope
- Check the key hasn't expired

### "Pre-flight check failed"
- Workspace may be corrupted
- Run `infinity build --skip-preflight --prompt "..."` to bypass
- Or create a fresh workspace

### "Budget exceeded"
- Check budget limits in Settings → Budgets
- Increase limits or wait for reset

### Build hangs / times out
- Increase GitHub Actions timeout: `timeout-minutes: 60`
- Reduce `--max-iterations`
- Check API server logs

### JSON parsing errors
- Ensure you're using `--json` or `--headless --json`
- For streaming, parse line-by-line (JSONL)

## Advanced: Custom Event Processing

```bash
# Filter only errors and final result
infinity build --headless --json --prompt "..." | \
  jq -c 'select(.type == "build.error" or .type == "build.completed" or .type == "build.failed")'

# Extract summary on success
infinity build --headless --json --prompt "..." | \
  jq -r 'select(.type == "build.completed") | .data.summary'

# Get all tool calls
infinity build --headless --json --prompt "..." | \
  jq -c 'select(.type == "build.tool_call") | {tool: .data.toolName, args: .data.args}'
```

## Self-Hosted API Server

If running your own Infinity API server:

```bash
export INFINITY_API_URL="https://your-domain.com"
export INFINITY_API_KEY="inf_..."
```

Ensure your server has:
- CORS configured for your CI domain
- WebSocket support (for preview if needed)
- Sufficient resources for concurrent builds