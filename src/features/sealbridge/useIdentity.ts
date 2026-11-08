import { useEffect, useState } from "react";
import type { SealbridgeStatus } from "../../../shared/sealbridge";

export function useIdentity() {
  const [status, setStatus] = useState<SealbridgeStatus>();
  const bridge = window.ogb?.sealbridge;
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const refresh = () => { void bridge.status().then(value => { if (active) setStatus(value); }).catch(() => { if (active) setStatus(undefined); }); };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [bridge]);
  return status;
}
