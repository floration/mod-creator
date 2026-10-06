#!/usr/bin/env bash
# Starts the example mod's dev server, waits until the world is up, then fails if Minecraft
# rejected any of the mod's data: advancements, loot tables, recipes, worldgen, tags.
# Run from the example's folder after `gradlew build`.
set -uo pipefail

log="$RUNNER_TEMP/server.log"
mkdir -p run
echo "eula=true" > run/eula.txt
printf 'online-mode=false\nlevel-seed=modcreator\nspawn-protection=0\n' > run/server.properties

./gradlew runServer --no-daemon > "$log" 2>&1 &
gradle=$!

status=1
for _ in $(seq 1 180); do
  if grep -q 'Done (' "$log"; then status=0; break; fi
  if ! kill -0 "$gradle" 2>/dev/null; then break; fi
  sleep 5
done
pkill -f 'net.fabricmc.devlaunchinjector.Main|KnotServer' 2>/dev/null
kill "$gradle" 2>/dev/null
wait "$gradle" 2>/dev/null

if [ "$status" -ne 0 ]; then
  echo "::error::The server didn't finish starting"
  tail -n 120 "$log"
  exit 1
fi

grep -E 'Loaded [0-9]+ advancements|Loaded [0-9]+ recipes' "$log" || true
problems=$(grep -E "/ERROR\]|Couldn't load advancements|Found validation problems|Couldn't parse|Failed to parse|Failed to load" "$log")
if [ -n "$problems" ]; then
  echo "::error::Minecraft reported problems loading the mod"
  echo "$problems"
  # The lines after each problem carry the details.
  grep -E -A8 "/ERROR\]|Couldn't load advancements|Found validation problems|Couldn't parse" "$log" | head -n 200
  exit 1
fi
echo "Server started with no data errors."
