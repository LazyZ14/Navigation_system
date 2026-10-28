import type { Coordinate } from "./types";

export interface Candidate { name: string; location: Coordinate }

export class VoiceSelection {
  private candidate: Candidate | null = null;
  constructor(private readonly navigate: (candidate: Candidate) => Promise<void> | void) {}
  select(candidate: Candidate): void { this.candidate = candidate; }
  cancel(): void { this.candidate = null; }
  async confirm(): Promise<void> {
    if (this.candidate === null) return;
    const candidate = this.candidate;
    this.candidate = null;
    await this.navigate(candidate);
  }
}
