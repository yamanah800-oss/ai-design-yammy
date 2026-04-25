#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Start HTTP server on port 8090 if not already running
if ! python3 -c "import socket; s=socket.socket(); s.settimeout(1); s.connect(('localhost', 8090)); s.close()" 2>/dev/null; then
  nohup python3 -m http.server 8090 --directory "$CLAUDE_PROJECT_DIR" > /tmp/yammy-http-server.log 2>&1 &
  echo "HTTP server started on port 8090"
else
  echo "HTTP server already running on port 8090"
fi
