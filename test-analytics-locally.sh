#!/bin/bash
# Test analytics integration locally before deploying

echo "🧪 Starting local web server for photoCompressorApp..."
echo ""
echo "This will serve your app at http://localhost:8080"
echo "Analytics will send events to: https://cb4db0cf3662.ngrok-free.app"
echo ""
echo "Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")"
python3 -m http.server 8080
