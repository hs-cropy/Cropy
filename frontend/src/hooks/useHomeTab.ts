
"use client";

import { useEffect, useState } from "react";

export type HomeTab = "capture" | "diagnosis";

export function useHomeTab(): HomeTab {
  const [tab, setTab] = useState<HomeTab>("capture");

  useEffect(() => {
    const syncTab = () => {
      const hash = window.location.hash;

      if (hash === "#diagnosis") {
        setTab("diagnosis");
      } else {
        setTab("capture");
      }
    };

    syncTab();

    window.addEventListener("hashchange", syncTab);
    window.addEventListener("popstate", syncTab);

    return () => {
      window.removeEventListener("hashchange", syncTab);
      window.removeEventListener("popstate", syncTab);
    };
  }, []);

  return tab;
}
