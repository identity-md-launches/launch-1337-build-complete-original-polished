/**
 * pepe-game/1 iframe bridge.
 *
 * The arcade loads the game in a sandboxed iframe (allow-scripts allow-pointer-lock).
 * The parent sends {protocol:'pepe-game/1', type:'init', channel}; we reply "ready",
 * then honour pause/resume on that channel and report a finite, non-negative
 * integer score at game over. postMessage targets '*' because the sandbox origin is
 * opaque; messages never carry secrets.
 */
const PROTOCOL = 'pepe-game/1';

export interface BridgeHandlers {
  pause(): void;
  resume(): void;
}

export interface Bridge {
  score(value: number): void;
  readonly connected: boolean;
}

export function connectBridge(handlers: BridgeHandlers): Bridge {
  let channel: string | undefined;
  const embedded = (() => {
    try {
      return window.parent !== window;
    } catch {
      return true;
    }
  })();

  function receive(event: MessageEvent): void {
    if (!embedded || event.source !== window.parent) return;
    const data = event.data as { protocol?: unknown; type?: unknown; channel?: unknown } | null;
    if (!data || typeof data !== 'object' || data.protocol !== PROTOCOL) return;
    if (data.type === 'init' && typeof data.channel === 'string' && data.channel.length <= 200) {
      channel = data.channel;
      window.parent.postMessage({ protocol: PROTOCOL, type: 'ready', channel }, '*');
      return;
    }
    if (!channel || data.channel !== channel) return;
    if (data.type === 'pause') handlers.pause();
    if (data.type === 'resume') handlers.resume();
  }

  window.addEventListener('message', receive);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) handlers.pause();
  });

  return {
    get connected() {
      return channel !== undefined;
    },
    score(value: number) {
      if (!channel) return;
      const score = Math.max(0, Math.floor(value));
      if (!Number.isSafeInteger(score)) return;
      window.parent.postMessage({ protocol: PROTOCOL, type: 'score', channel, score }, '*');
    },
  };
}
