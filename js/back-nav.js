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
  getCurrentTab,
  onBackFromPlayer,
  onBackFromFavorites,
  onBackFromSettings,
  onBackFromMainDrillDown,
  onBackToHome,
}) {
  let navDepth = "root";
  let lastMainTab = "home";
  let wired = false;

  function updateMainBackButton() {
    const btn = document.getElementById("btn-back-main");
    if (!btn) return;
    const tab = getCurrentTab?.() || "home";
    const show = navDepth !== "root" || (tab !== "home" && tab !== "search");
    btn.hidden = !show;
  }

  function setNavDepth(depth) {
    navDepth = depth;
    updateMainBackButton();
  }

  function rememberMainTab(tab) {
    if (tab && tab !== "settings" && tab !== "search") lastMainTab = tab;
    updateMainBackButton();
  }

  function getLastMainTab() {
    return lastMainTab;
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
    const tab = getCurrentTab?.() || "home";
    if (screen === "screen-main" && tab !== "home") {
      onBackToHome?.();
      return true;
    }
    return false;
  }

  function wireUi() {
    if (wired) return;
    wired = true;
    document.getElementById("btn-back-main")?.addEventListener("click", () => handleBack());
    document.getElementById("btn-back-settings")?.addEventListener("click", () => handleBack());
    document.getElementById("btn-back-favorites")?.addEventListener("click", () => handleBack());
    document.getElementById("btn-close-player")?.addEventListener("click", () => handleBack());
  }

  function setupNativeBridge() {
    window.__tuneFriendBack = () => handleBack();

    if (!isNativeApp()) return;
    const cap = window.Capacitor;
    const App = cap?.Plugins?.App ?? cap?.registerPlugin?.("App");
    if (!App?.addListener) return;

    App.addListener("backButton", () => {
      if (!handleBack()) App.minimizeApp?.();
    });
  }

  function init() {
    wireUi();
    setupNativeBridge();
    updateMainBackButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    setNavDepth,
    rememberMainTab,
    getLastMainTab,
    handleBack,
    updateMainBackButton,
  };
}