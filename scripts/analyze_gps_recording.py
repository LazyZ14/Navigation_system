#!/usr/bin/env python3
"""Analyze GPS recording JSONL files exported from iPhone."""

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def parse_iso_timestamp(ts_str: str) -> datetime:
    """Parse ISO 8601 timestamp string to datetime."""
    # Handle various ISO formats
    ts_str = ts_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts_str)
    except ValueError:
        # Fallback for simpler formats
        return datetime.strptime(ts_str, "%Y-%m-%dT%H:%M:%S%z")


def analyze_recording(file_path: Path) -> dict:
    """Analyze a single JSONL recording file."""
    if not file_path.exists():
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    samples = []
    metadata_start = None
    metadata_end = None
    error_count = 0
    duplicate_timestamps = 0
    seen_timestamps = set()

    with open(file_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue

            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                error_count += 1
                continue

            record_type = record.get("type")

            if record_type == "recording_session":
                metadata_start = record
            elif record_type == "recording_end":
                metadata_end = record
            elif record_type == "gps_fix":
                # Parse timestamp
                ts_str = record.get("timestamp")
                if ts_str:
                    try:
                        ts = parse_iso_timestamp(ts_str)
                        record["_parsed_ts"] = ts

                        # Check for duplicate timestamps
                        ts_key = ts.isoformat()
                        if ts_key in seen_timestamps:
                            duplicate_timestamps += 1
                        seen_timestamps.add(ts_key)
                    except (ValueError, TypeError):
                        error_count += 1
                        continue

                samples.append(record)

    if not samples:
        print("No GPS fix samples found in file.", file=sys.stderr)
        sys.exit(1)

    # Sort by timestamp
    samples.sort(key=lambda x: x.get("_parsed_ts", datetime.min.replace(tzinfo=timezone.utc)))

    # Calculate intervals
    intervals = []
    for i in range(1, len(samples)):
        ts1 = samples[i - 1].get("_parsed_ts")
        ts2 = samples[i].get("_parsed_ts")
        if ts1 and ts2:
            interval = (ts2 - ts1).total_seconds()
            intervals.append(interval)

    # Calculate statistics
    total_samples = len(samples)
    total_duration = 0
    if metadata_start and metadata_end:
        start_time = parse_iso_timestamp(metadata_start["start_time"])
        end_time = parse_iso_timestamp(metadata_end["end_time"])
        total_duration = (end_time - start_time).total_seconds()
    elif intervals:
        total_duration = sum(intervals)

    avg_interval = sum(intervals) / len(intervals) if intervals else 0
    sorted_intervals = sorted(intervals) if intervals else []
    p50_interval = sorted_intervals[len(sorted_intervals) // 2] if sorted_intervals else 0
    p95_idx = int(len(sorted_intervals) * 0.95) if sorted_intervals else 0
    p95_interval = sorted_intervals[p95_idx] if sorted_intervals and p95_idx < len(sorted_intervals) else 0
    max_interval = max(intervals) if intervals else 0

    # Count long intervals
    long_intervals = {
        ">2s": sum(1 for i in intervals if i > 2),
        ">5s": sum(1 for i in intervals if i > 5),
        ">10s": sum(1 for i in intervals if i > 10),
    }

    # Location age statistics
    location_ages = [s.get("location_age_s", 0) for s in samples if s.get("location_age_s") is not None]
    avg_location_age = sum(location_ages) / len(location_ages) if location_ages else 0

    # Accuracy statistics
    accuracies = [s.get("accuracy_m") for s in samples if s.get("accuracy_m") is not None]
    avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else 0
    min_accuracy = min(accuracies) if accuracies else 0
    max_accuracy = max(accuracies) if accuracies else 0

    # Speed statistics
    speeds = [s.get("speed_mps") for s in samples if s.get("speed_mps") is not None]
    avg_speed = sum(speeds) / len(speeds) if speeds else 0
    max_speed = max(speeds) if speeds else 0

    # Heading statistics
    headings = [s.get("heading_deg") for s in samples if s.get("heading_deg") is not None]

    # Detect speed jumps (>20 m/s change between consecutive samples)
    speed_jumps = 0
    for i in range(1, len(speeds)):
        if abs(speeds[i] - speeds[i - 1]) > 20:
            speed_jumps += 1

    # Null value counts
    null_speeds = sum(1 for s in samples if s.get("speed_mps") is None)
    null_headings = sum(1 for s in samples if s.get("heading_deg") is None)

    return {
        "file": str(file_path),
        "session_id": metadata_start.get("session_id") if metadata_start else "unknown",
        "device_model": metadata_start.get("device_model", "unknown") if metadata_start else "unknown",
        "os_version": metadata_start.get("os_version", "unknown") if metadata_start else "unknown",
        "total_samples": total_samples,
        "total_duration_s": total_duration,
        "avg_sample_interval_s": avg_interval,
        "p50_sample_interval_s": p50_interval,
        "p95_sample_interval_s": p95_interval,
        "max_sample_interval_s": max_interval,
        "long_intervals": long_intervals,
        "duplicate_timestamps": duplicate_timestamps,
        "avg_location_age_s": avg_location_age,
        "accuracy": {
            "avg_m": avg_accuracy,
            "min_m": min_accuracy,
            "max_m": max_accuracy,
        },
        "speed": {
            "avg_mps": avg_speed,
            "max_mps": max_speed,
            "null_count": null_speeds,
            "jumps_over_20mps": speed_jumps,
        },
        "heading": {
            "null_count": null_headings,
        },
        "error_count": error_count,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze GPS recording JSONL files")
    parser.add_argument("files", nargs="+", type=Path, help="JSONL files to analyze")
    args = parser.parse_args()

    all_results = []
    for file_path in args.files:
        result = analyze_recording(file_path)
        all_results.append(result)

        print(f"\n{'='*60}")
        print(f"File: {result['file']}")
        print(f"Session ID: {result['session_id']}")
        print(f"Device: {result['device_model']} ({result['os_version']})")
        print(f"{'='*60}")
        print(f"Total samples: {result['total_samples']}")
        print(f"Total duration: {result['total_duration_s']:.1f}s ({result['total_duration_s']/60:.1f}min)")
        print(f"\nSampling Intervals:")
        print(f"  Average: {result['avg_sample_interval_s']:.2f}s")
        print(f"  P50: {result['p50_sample_interval_s']:.2f}s")
        print(f"  P95: {result['p95_sample_interval_s']:.2f}s")
        print(f"  Max: {result['max_sample_interval_s']:.2f}s")
        print(f"\nLong Intervals:")
        for threshold, count in result['long_intervals'].items():
            print(f"  {threshold}: {count}")
        print(f"\nDuplicate Timestamps: {result['duplicate_timestamps']}")
        print(f"\nLocation Age:")
        print(f"  Average: {result['avg_location_age_s']:.2f}s")
        print(f"\nAccuracy (horizontal):")
        print(f"  Average: {result['accuracy']['avg_m']:.1f}m")
        print(f"  Min: {result['accuracy']['min_m']:.1f}m")
        print(f"  Max: {result['accuracy']['max_m']:.1f}m")
        print(f"\nSpeed:")
        print(f"  Average: {result['speed']['avg_mps']:.1f} m/s ({result['speed']['avg_mps']*3.6:.1f} km/h)")
        print(f"  Max: {result['speed']['max_mps']:.1f} m/s ({result['speed']['max_mps']*3.6:.1f} km/h)")
        print(f"  Null values: {result['speed']['null_count']}")
        print(f"  Jumps >20 m/s: {result['speed']['jumps_over_20mps']}")
        print(f"\nHeading:")
        print(f"  Null values: {result['heading']['null_count']}")
        print(f"\nErrors: {result['error_count']}")

    if len(all_results) > 1:
        print(f"\n{'='*60}")
        print(f"Summary across {len(all_results)} files:")
        print(f"{'='*60}")
        total_samples = sum(r['total_samples'] for r in all_results)
        total_duration = sum(r['total_duration_s'] for r in all_results)
        print(f"Total samples: {total_samples}")
        print(f"Total duration: {total_duration:.1f}s ({total_duration/60:.1f}min)")
        print(f"Average sample rate: {total_samples/total_duration:.2f} Hz" if total_duration > 0 else "N/A")


if __name__ == "__main__":
    main()
