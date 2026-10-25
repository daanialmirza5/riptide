import { useEffect } from "react";
import { api } from "./api";
import { useStore } from "./store";
import type { Snapshot } from "./types";

/** Maintains one WebSocket to the engine with exponential-backoff reconnects. */
export function useLiveFeed() {
  useEffect(() => {
    const { ingest, setConnection, setCatalog } = useStore.getState();
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    api.catalog().then(setCatalog).catch(() => undefined);

    const connect = () => {
      setConnection("connecting");
      ws = new WebSocket(api.wsUrl());
      ws.onopen = () => {
        retry = 0;
        setConnection("live");
        api
          .logs({ limit: "300" })
          .then((r) => useStore.setState((st) => ({ logs: st.logs.length ? st.logs : r.logs })))
          .catch(() => undefined);
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 20000);
      };
      ws.onmessage = (ev) => {
        try {
          ingest(JSON.parse(ev.data) as Snapshot);
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        setConnection("offline");
        timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(timer);
      ws?.close();
    };
  }, []);
}
