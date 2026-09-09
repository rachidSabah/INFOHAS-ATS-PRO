/**
 * ResumeAI Pro — preload script.
 * Minimal surface: the renderer runs the normal web app; this only exposes
 * a tiny read-only descriptor so the UI could (later) adapt to desktop mode.
 * No Node APIs, no IPC channels — contextIsolation stays fully on.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopInfo", {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || null,
});
