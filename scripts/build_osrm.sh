#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <input.osm|input.osm.pbf>" >&2
  exit 2
fi

input_path=$1
case "$input_path" in
  *.osm|*.osm.pbf) ;;
  *) echo "input must end in .osm or .osm.pbf" >&2; exit 2 ;;
esac
if [[ ! -f "$input_path" ]]; then
  echo "input file does not exist: $input_path" >&2
  exit 2
fi

project_root=$(cd "$(dirname "$0")/.." && pwd)
raw_dir="$project_root/data/raw"
output_dir="$project_root/data/osrm"
input_name=$(basename "$input_path")
source_stem=${input_name%.pbf}
source_stem=${source_stem%.osm}

if [[ "$(cd "$(dirname "$input_path")" && pwd)" != "$raw_dir" ]]; then
  echo "input must be placed in $raw_dir" >&2
  exit 2
fi

mkdir -p "$output_dir"
docker run --rm -v "$project_root/data:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-extract -p /opt/car.lua "/data/raw/$input_name"

shopt -s nullglob
raw_artifacts=("$raw_dir/$source_stem".osrm*)
if (( ${#raw_artifacts[@]} == 0 )); then
  echo "osrm-extract produced no .osrm artifacts" >&2
  exit 1
fi
for artifact in "${raw_artifacts[@]}"; do
  suffix=${artifact#"$raw_dir/$source_stem".osrm}
  mv "$artifact" "$output_dir/beijing.osrm$suffix"
done

docker run --rm -v "$project_root/data:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-partition /data/osrm/beijing.osrm
docker run --rm -v "$project_root/data:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-customize /data/osrm/beijing.osrm

"$project_root/scripts/verify_data.py" \
  --input "$input_path" \
  --command "$0 $input_path" \
  --artifact osrm-mld \
  --tool-version ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  --output data/osrm/beijing.osrm
