import { describe, expect, it, vi } from "vitest";
import {
  computeModePanelVisibility,
  LiveGpsStreamClient,
  resolveMapClickAction,
} from "../amap-main";
import type { LiveGpsFixPayload } from "../amap-live-controller";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

const SAMPLE_FIX: LiveGpsFixPayload = {
  device_id: "iphone",
  stream_id: "19989152-7c55-40c8-b98f-fdf7d5aa81d9",
  sequence: 7,
  lat: 22.3734,
  lon: 113.5786,
  accuracy_m: 5.5,
  speed_mps: 6.0,
  heading_deg: 90,
  timestamp: "2026-11-27T05:10:00.000Z",
  received_at: "2026-11-27T05:10:00.030Z",
};

describe("amap dual-mode UI & transport helpers", () => {
  it("isolates map-click behavior and panel visibility between demo and live modes", () => {
    // Demo mode: 1st click origin, 2nd click destination, 3rd click resets origin
    expect(resolveMapClickAction("demo", false, false)).toEqual({
      target: "origin",
      clearDestination: false,
    });
    expect(resolveMapClickAction("demo", true, false)).toEqual({
      target: "destination",
      clearDestination: false,
    });
    expect(resolveMapClickAction("demo", true, true)).toEqual({
      target: "origin",
      clearDestination: true,
    });

    // Live mode: map click ONLY sets destination, never overwrites live origin
    expect(resolveMapClickAction("live", false, false)).toEqual({
      target: "destination",
      clearDestination: false,
    });
    expect(resolveMapClickAction("live", true, false)).toEqual({
      target: "destination",
      clearDestination: false,
    });
    expect(resolveMapClickAction("live", true, true)).toEqual({
      target: "destination",
      clearDestination: false,
    });

    expect(computeModePanelVisibility("demo")).toEqual({
      showDemoLocateBox: true,
      showPresetButton: true,
      showCruiseButton: true,
      showLiveTelemetryBox: false,
    });
    expect(computeModePanelVisibility("live")).toEqual({
      showDemoLocateBox: false,
      showPresetButton: false,
      showCruiseButton: false,
      showLiveTelemetryBox: true,
    });
  });

  it("loads initial /api/gps/latest snapshot, streams WS frames, reconnects on drop, and tears down cleanly on stop", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const receivedFixes: LiveGpsFixPayload[] = [];
    let heartbeats = 0;

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ active: true, age_ms: 40, fix: SAMPLE_FIX }),
    })) as unknown as typeof fetch;

    try {
      const client = new LiveGpsStreamClient({
        wsUrl: "ws://127.0.0.1:5173/ws/gps/live",
        latestUrl: "/api/gps/latest",
        fetchImpl: fakeFetch,
        createWebSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket,
        onFix: (fix) => receivedFixes.push(fix),
        onHeartbeat: () => {
          heartbeats += 1;
        },
      });

      client.start();
      await Promise.resolve();
      await Promise.resolve();

      // Initial active snapshot ingested + 1st WebSocket opened
      expect(receivedFixes).toHaveLength(1);
      expect(receivedFixes[0].sequence).toBe(7);
      expect(FakeWebSocket.instances).toHaveLength(1);

      // Push live frame over WebSocket
      const ws1 = FakeWebSocket.instances[0];
      ws1.onmessage?.({
        data: JSON.stringify({ ...SAMPLE_FIX, sequence: 8, lat: 22.3740 }),
      });
      expect(receivedFixes).toHaveLength(2);
      expect(receivedFixes[1].sequence).toBe(8);

      // Heartbeat fires every 1s
      vi.advanceTimersByTime(1000);
      expect(heartbeats).toBe(1);

      // Unexpected close triggers reconnect after 1s backoff
      ws1.onclose?.();
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(2);

      // Switching back to demo calls stop(): closes active WS and cancels timers
      client.stop();
      expect(FakeWebSocket.instances[1].closed).toBe(true);
      const hbBefore = heartbeats;
      vi.advanceTimersByTime(5000);
      expect(heartbeats).toBe(hbBefore);
      expect(FakeWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
