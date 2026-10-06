#!/usr/bin/env bash
# Starts the example mod's dev server, waits until the world is up, then fails if Minecraft
# rejected any of the mod's data: advancements, loot tables, recipes, worldgen, tags.
# Run from the example's folder after `gradlew build`.
set -uo pipefail

log="$RUNNER_TEMP/server.log"
mkdir -p run
echo "eula=true" > run/eula.txt
printf 'online-mode=false\nlevel-seed=modcreator\nspawn-protection=0\n' > run/server.properties

# A data pack that places each structure and grows each tree once the world is up, and reports the result in the log.
ids() {
  node -e '
    const fs = require("fs");
    const mod = JSON.parse(fs.readFileSync("modcreator.json", "utf8")).modId;
    const dir = process.argv[1];
    const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => `${mod}:${JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")).id}`) : [];
    console.log(ids.join(" "));
  ' "$1"
}
structures=$(ids spec/structures)
trees=$(ids spec/trees)
checks="$structures$trees"
if [ -n "$checks" ]; then
  pack=run/world/datapacks/modcreator_check
  mkdir -p "$pack/data/check/function" "$pack/data/minecraft/tags/function"
  echo '{"pack":{"description":"Mod Creator CI check","pack_format":121,"min_format":121,"max_format":121}}' > "$pack/pack.mcmeta"
  echo '{"values":["check:load"]}' > "$pack/data/minecraft/tags/function/load.json"
  printf 'scoreboard objectives add check dummy\nforceload add -32 -32 255 31\nschedule function check:place 100t\n' > "$pack/data/check/function/load.mcfunction"
  : > "$pack/data/check/function/place.mcfunction"
  for id in $structures; do
    for what in template structure; do
      y=$([ "$what" = template ] && echo 200 || echo 64)
      cat >> "$pack/data/check/function/place.mcfunction" <<MCFUNCTION
execute store success score #placed check run place $what $id 0 $y 0
execute if score #placed check matches 1 run say MODCREATOR CHECK placed $what $id
execute unless score #placed check matches 1 run say MODCREATOR CHECK FAILED to place $what $id
MCFUNCTION
    done
  done
  # Trees grow in open air east of the structures, spaced apart and inside the forceloaded chunks, so only a
  # broken feature fails to place.
  x=48
  for id in $trees; do
    cat >> "$pack/data/check/function/place.mcfunction" <<MCFUNCTION
execute store success score #placed check run place feature $id $x 200 0
execute if score #placed check matches 1 run say MODCREATOR CHECK placed feature $id
execute unless score #placed check matches 1 run say MODCREATOR CHECK FAILED to place feature $id
MCFUNCTION
    x=$((x + 24))
  done
  echo 'say MODCREATOR CHECK done' >> "$pack/data/check/function/place.mcfunction"
fi

./gradlew runServer --no-daemon > "$log" 2>&1 &
gradle=$!

status=1
for _ in $(seq 1 180); do
  if grep -q 'Done (' "$log" && { [ -z "$checks" ] || grep -q 'MODCREATOR CHECK done' "$log"; }; then status=0; break; fi
  if ! kill -0 "$gradle" 2>/dev/null; then break; fi
  sleep 5
done
pkill -f 'net.fabricmc.devlaunchinjector.Main|KnotServer' 2>/dev/null
kill "$gradle" 2>/dev/null
wait "$gradle" 2>/dev/null

if [ "$status" -ne 0 ]; then
  echo "::error::The server didn't finish starting$([ -n "$checks" ] && echo ' or placing structures and trees')"
  tail -n 120 "$log"
  exit 1
fi

grep -E 'Loaded [0-9]+ advancements|Loaded [0-9]+ recipes|MODCREATOR CHECK' "$log" || true
if grep -q 'MODCREATOR CHECK FAILED' "$log"; then
  echo "::error::A structure or tree couldn't be placed"
  exit 1
fi
problems=$(grep -E "/ERROR\]|Couldn't load advancements|Found validation problems|Couldn't parse|Failed to parse|Failed to load" "$log")
if [ -n "$problems" ]; then
  echo "::error::Minecraft reported problems loading the mod"
  echo "$problems"
  # The lines after each problem carry the details.
  grep -E -A8 "/ERROR\]|Couldn't load advancements|Found validation problems|Couldn't parse" "$log" | head -n 200
  exit 1
fi
echo "Server started with no data errors."
