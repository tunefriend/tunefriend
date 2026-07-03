/*
 * TuneFriend
 * Copyright (C) 2026 James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { isNativeApp } from "./api.js";

export function createBackNav({
  getActiveScreen,
  onBackFromPlayer,
  onBackFromFavorites,
  onBackFromSettings,
  onBackFromMainDrillDown,
}) {
  let navDepth = "root";
  let lastMainTab = "home";

  function setNavDepth(depth) {
    navDepth = depth;
    const btn = document.getElementById("btn-back-main");
    if (btn) btn.hidden = depth === "root";
  }

  function rememberMainTab(tab) {
    if (tab && tab !== "settings" && tab !== "search") lastMainTab = tab;
  }

  function getLastMainTab() {
    return lastMainTab;
  }

  function isMainDrillDown() {
    return navDepth !== "root";
  }

  function handleBack() {
    const screen = getActiveScreen();
    if (screen === "screen-player") {
      onBackFromPlayer?.();
      return true;
    }
    if (screen === "screen-favorites") {
      onBackFromFavorites?.();
      return true;
    }
    if (screen === "screen-settings") {
      onBackFromSettings?.(lastMainTab);
      return true;
    }
    if (screen === "screen-main" && navDepth !== "root") {
      onBackFromMainDrillDown?.();
      return true;
    }
    return false;
  }

  function setupNativeBackButton() {
    if (!isNativeApp()) return;
    const cap = window.Capacitor;
    const App = cap?.registerPlugin?.("App") ?? cap?.Plugins?.App;
    if (!App?.addListener) return;

    App.addListener("backButton", () => {
      if (!handleBack()) App.minimizeApp?.();
    });
  }

  function wireBackButtons() {
    document.getElementById("btn-back-main")?.addEventListener("click", handleBack);
    document.getElementById("btn-back-settings")?.addEventListener("click", handleBack);
    document.getElementById("btn-back-favorites")?.addEventListener("click", handleBack);
    document.getElementById("btn-close-player")?.addEventListener("click", handleBack);
  }

  setupNativeBackButton();
  wireBackButtons();

  return {
    setNavDepth,
    rememberMainTab,
    getLastMainTab,
    isMainDrillDown,
    handleBack,
  };
}