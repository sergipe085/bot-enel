#!/bin/bash

# Start ngrok in the background
echo "Starting ngrok..."
ngrok http 3000 > /dev/null &
NGROK_PID=$!

# Wait for ngrok to initialize
sleep 3

# Get the ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*' | grep -o 'http[^"]*')

if [ -z "$NGROK_URL" ]; then
  echo "Failed to get ngrok URL. Make sure ngrok is installed and running properly."
  kill $NGROK_PID
  exit 1
fi

# Save the ngrok URL to a file
echo $NGROK_URL > ./.ngrok-url
echo "Ngrok URL: $NGROK_URL"

# Start the captcha server
echo "Starting captcha server..."
npx tsx src/start-captcha-server-ngrok.ts

# Cleanup on exit
function cleanup {
  echo "Shutting down ngrok..."
  kill $NGROK_PID
  rm -f ./.ngrok-url
  echo "Done."
}

trap cleanup EXIT
