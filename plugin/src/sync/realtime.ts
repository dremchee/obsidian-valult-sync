import { ApiError } from "../api";
import { t } from "../i18n";
import type { SyncSettings, SyncState } from "../types";

interface RealtimePayload {
  latest_seq: number;
}

export interface RealtimeSyncHandlers {
  onRemoteChange: (latestSeq: number) => Promise<void>;
  onUnauthorized: () => void;
}

export class RealtimeSyncClient {
  private abortController: AbortController | null = null;
  private reconnectTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private generation = 0;

  constructor(
    private readonly getSettings: () => SyncSettings,
    private readonly getState: () => SyncState,
    private readonly handlers: RealtimeSyncHandlers,
  ) {}

  restart(): void {
    this.stop();

    const settings = this.getSettings();
    if (!settings.autoSync || !settings.serverUrl.trim() || !settings.authToken.trim()) {
      return;
    }

    void this.connect(this.generation);
  }

  stop(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    if (this.reconnectTimeoutId !== null) {
      globalThis.clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private async connect(generation: number): Promise<void> {
    const settings = this.getSettings();
    const serverUrl = settings.serverUrl.trim().replace(/\/+$/, "");
    if (!serverUrl || !settings.authToken.trim()) {
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;

    try {
      const response = await fetch(
        `${serverUrl}/events?vault_id=${encodeURIComponent(settings.vaultId)}&since=${this.getState().lastSeq}`,
        {
          method: "GET",
          headers: buildRealtimeHeaders(settings.authToken),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw await apiErrorFromFetchResponse(response);
      }

      if (!response.body) {
        throw new Error(t("sync.realtime.unavailable"));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseRealtimeSseBuffer(buffer);
        buffer = parsed.remainder;

        for (const event of parsed.events) {
          await this.handlers.onRemoteChange(event.latest_seq);
        }
      }

      buffer += decoder.decode();
      const parsed = parseRealtimeSseBuffer(buffer);
      for (const event of parsed.events) {
        await this.handlers.onRemoteChange(event.latest_seq);
      }

      this.scheduleReconnect(generation, 1000);
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) {
        return;
      }

      if (error instanceof ApiError && error.status === 401) {
        console.warn("obsidian-sync: realtime authorization failed", error);
        this.handlers.onUnauthorized();
        return;
      }

      const retryDelayMs = 5_000;
      console.warn("obsidian-sync: realtime stream disconnected", error);
      this.scheduleReconnect(generation, retryDelayMs);
    }
  }

  private scheduleReconnect(generation: number, delayMs: number): void {
    if (generation !== this.generation) {
      return;
    }

    this.reconnectTimeoutId = globalThis.setTimeout(() => {
      if (generation !== this.generation) {
        return;
      }

      void this.connect(generation);
    }, delayMs);
  }
}

export function parseRealtimeSseBuffer(buffer: string): {
  events: RealtimePayload[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const chunks = normalized.split("\n\n");
  const remainder = chunks.pop() ?? "";
  const events: RealtimePayload[] = [];

  for (const chunk of chunks) {
    const dataLines = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0);

    if (dataLines.length === 0) {
      continue;
    }

    try {
      const payload = JSON.parse(dataLines.join("\n")) as Partial<RealtimePayload>;
      if (typeof payload.latest_seq === "number") {
        events.push({ latest_seq: payload.latest_seq });
      }
    } catch (error) {
      console.warn("obsidian-sync: failed to parse realtime payload", error);
    }
  }

  return { events, remainder };
}

async function apiErrorFromFetchResponse(response: Response): Promise<ApiError> {
  const text = await response.text();

  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    return new ApiError(
      json.message || text || `Request failed with status ${response.status}`,
      response.status,
      json.error,
    );
  } catch {
    return new ApiError(text || `Request failed with status ${response.status}`, response.status);
  }
}

function buildRealtimeHeaders(authToken: string): Record<string, string> {
  if (!authToken.trim()) {
    return {};
  }

  return {
    Authorization: `Bearer ${authToken.trim()}`,
  };
}
