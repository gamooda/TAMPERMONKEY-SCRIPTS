// ==UserScript==
// @name         Twitch Panels Telegram Spoiler + AutoChat
// @namespace    twitch-panels-telegram-spoiler
// @version      12.2
// @description  Telegram-style particle blur + AutoChat with advanced features
// @match        https://www.twitch.tv/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    const STORAGE_KEY = 'tm-autochat-v10'; const MAX_CHARS = 500; const HOLD_SEND_MS = 1000;
    function loadData() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { return {}; }
    }
    function saveData(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    function getSettings() {
        const d = loadData();
        return {
            livePreview: d.livePreview !== false,
            spoilerEnabled: d.spoilerEnabled !== false,
            spoilerNeverReveal: !!d.spoilerNeverReveal,
            antiSpamRandomizer: !!d.antiSpamRandomizer
        };
    }
    const STYLE_ID = 'tm-telegram-spoiler-style'; const followersOnlyCache = new Map(); const followersFocusAttempts = new Set();
    let refreshAutoChatVisibility = null; let refreshChatListeners = null; let refreshChannelState = null; let refreshFollowersOnlyStatus = null;
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.tm-spoiler-target { position: relative !important; overflow: hidden !important; border-radius: var(--border-radius-medium, 4px); cursor: pointer; display: block; }
.tm-spoiler-img { filter: blur(22px) brightness(0.5); display: block !important; width: 100% !important; height: auto !important; opacity: .94; transform: scale(1.025); transition: opacity .2s ease, transform .2s ease; will-change: opacity, transform; }
.tm-spoiler-target.tm-revealed .tm-spoiler-img { filter: blur(0) brightness(1); opacity: 1; transform: scale(1); }
body.tm-spoiler-off .tm-spoiler-img { filter: none !important; transform: none !important; opacity: 1 !important; }
body.tm-spoiler-never-reveal .tm-spoiler-target .tm-spoiler-img { filter: blur(22px) brightness(0.5) !important; opacity: .94 !important; transform: scale(1.025) !important; }
@keyframes tm-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.6); border-color: rgba(255, 215, 0, 0.8); }
  70% { box-shadow: 0 0 0 12px rgba(255, 215, 0, 0); border-color: rgba(255, 215, 0, 0.8); }
  100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0); border-color: #2f2f35; }
}
@keyframes tm-pop {
  0% { transform: scale(0.8) translate(0, -50%); opacity: 0; }
  50% { transform: scale(1.1) translate(0, -50%); opacity: 1; }
  100% { transform: scale(1) translate(0, -50%); }
}
#tm-autochat-toggle-btn { position: fixed; top: 50%; right: 0; transform: translate(0, -50%); width: 24px; height: 60px; background: #18181b; border: 1px solid #2f2f35; border-right: none; border-radius: 8px 0 0 8px; color: #efeff1; z-index: 20; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; opacity: 0; visibility: hidden; pointer-events: none; transition: right 0s linear, transform 0.3s ease, background 0.2s; will-change: right, transform, opacity; }
#tm-autochat-toggle-btn.visible { opacity: 1; visibility: visible; pointer-events: auto; animation: tm-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, tm-pulse 1s ease-in-out 3 0.4s; }
#tm-autochat-toggle-btn:hover { background: #2f2f35; }
#tm-autochat-toggle-btn.open { transform: translate(-380px, -50%); animation: none; }
#tm-autochat-panel { position: fixed; top: 50%; right: 0; width: 380px; height: 650px; max-height: 85vh; background: #18181b; border: 1px solid #2f2f35; border-radius: 12px 0 0 12px; z-index: 20; color: #efeff1; font-family: Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif; box-shadow: -12px 0 40px rgba(0,0,0,.6); user-select: none; overflow: hidden; display: flex; flex-direction: column; transform: translate(100%, -50%); opacity: 0; visibility: hidden; pointer-events: none; transition: right 0s linear, transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease, visibility 0.3s ease; will-change: right, transform; }
#tm-autochat-panel.open { transform: translate(0, -50%); opacity: 1; visibility: visible; pointer-events: auto; }
#tm-autochat-panel .tm-ac-header { padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; background: #0e0e10; border-bottom: 1px solid #2f2f35; gap: 10px; }
.tm-ac-header-left { display: flex; align-items: center; gap: 10px; overflow: hidden; }
#tm-autochat-panel .tm-ac-header-title { font-size: 14px; font-weight: 600; letter-spacing: 0.3px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.tm-ac-header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.tm-ac-status-pill { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 12px; background: #1a1a1d; font-size: 11px; font-weight: 500; color: #adadb8; white-space: nowrap; transition: all 0.2s; }
.tm-ac-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b6b70; }
.tm-ac-status-pill.running { background: rgba(0, 245, 147, 0.1); color: #00f593; }
.tm-ac-status-pill.running .tm-ac-status-dot { background: #00f593; }
.tm-ac-status-pill.paused { background: rgba(255, 184, 0, 0.1); color: #ffb800; }
.tm-ac-status-pill.paused .tm-ac-status-dot { background: #ffb800; }
.tm-ac-status-pill.blocked { background: rgba(233, 25, 22, 0.1); color: #ff6b6b; }
.tm-ac-status-pill.blocked .tm-ac-status-dot { background: #ff6b6b; }
.tm-ac-status-pill.slowmode { background: rgba(145, 71, 255, 0.15); color: #bf94ff; }
.tm-ac-status-pill.slowmode .tm-ac-status-dot { background: #bf94ff; }
.tm-ac-header-btn { background: #2f2f35; border: none; color: #efeff1; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; transition: background .15s; }
.tm-ac-header-btn:hover { background: #3a3a3d; }
.tm-ac-header-btn.start { color: #00f593; }
.tm-ac-header-btn.stop { color: #ff6b6b; }
.tm-ac-header-btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
#tm-autochat-toggle { background: #2f2f35; border: none; color: #adadb8; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center; transition: background .15s; }
#tm-autochat-toggle:hover { background: #e91916; color: #fff; }
#tm-autochat-panel .tm-ac-tabs { display: flex; background: #0e0e10; border-bottom: 1px solid #2f2f35; flex-shrink: 0; }
#tm-autochat-panel .tm-ac-tab { flex: 1; padding: 10px 0; text-align: center; font-size: 13px; font-weight: 500; color: #adadb8; cursor: pointer; border-bottom: 2px solid transparent; transition: all .15s; }
#tm-autochat-panel .tm-ac-tab:hover { color: #efeff1; background: #1a1a1d; }
#tm-autochat-panel .tm-ac-tab.active { color: #bf94ff; border-bottom-color: #9147ff; }
#tm-autochat-panel .tm-ac-body { padding: 16px; overflow-y: auto; flex: 1; }
#tm-autochat-panel .tm-ac-tab-content { display: none; }
#tm-autochat-panel .tm-ac-tab-content.active { display: block; }
#tm-autochat-panel textarea { width: 100%; height: 150px; min-height: 150px; background: #0e0e10; border: 1px solid #2f2f35; border-radius: 8px; color: #efeff1; padding: 10px 12px; resize: none !important; font-size: 13px; line-height: 1.45; box-sizing: border-box; outline: none; transition: border-color .15s; overflow-y: auto; }
#tm-autochat-panel textarea:focus { border-color: #9147ff; }
#tm-ac-char-count { text-align: right; font-size: 11px; color: #6b6b70; margin-top: 4px; }
#tm-ac-char-count.over { color: #ff4d4d; }
#tm-autochat-panel input[type="number"] { width: 72px; background: #0e0e10; border: 1px solid #2f2f35; border-radius: 6px; color: #efeff1; padding: 7px 10px; font-size: 13px; outline: none; }
#tm-autochat-panel input[type="number"]:focus { border-color: #9147ff; }
#tm-autochat-panel .tm-ac-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; font-size: 13px; color: #adadb8; }
#tm-autochat-panel .tm-ac-hint { font-size: 11px; color: #6b6b70; }
#tm-autochat-panel .tm-ac-check { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; color: #adadb8; cursor: pointer; }
#tm-autochat-panel .tm-ac-check.locked { opacity: 0.5; cursor: not-allowed; }
#tm-autochat-panel .tm-ac-check input { width: 16px; height: 16px; accent-color: #9147ff; cursor: pointer; }
#tm-autochat-panel .tm-ac-check.locked input { cursor: not-allowed; }
#tm-autochat-panel .tm-ac-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid #2f2f35; }
#tm-autochat-panel .tm-ac-section-title { font-size: 12px; font-weight: 600; color: #bf94ff; margin-bottom: 8px; margin-top: 16px; }
#tm-autochat-panel .tm-ac-desc { font-size: 11px; color: #6b6b70; line-height: 1.4; margin-top: 8px; }
.tm-ac-hist-filter-wrapper { position: relative; width: 100%; margin-bottom: 12px; user-select: none; }
.tm-ac-hist-filter-header { display: flex; align-items: center; justify-content: space-between; background: #0e0e10; border: 1px solid #2f2f35; border-radius: 6px; padding: 8px 10px; font-size: 13px; color: #efeff1; cursor: pointer; transition: border-color 0.15s; }
.tm-ac-hist-filter-header:hover { border-color: #9147ff; }
.tm-ac-hist-filter-list { position: absolute; top: 100%; left: 0; width: 100%; background: #18181b; border: 1px solid #2f2f35; border-radius: 6px; margin-top: 4px; max-height: 200px; overflow-y: auto; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: none; }
.tm-ac-hist-filter-list.open { display: block; }
.tm-ac-hist-filter-list::-webkit-scrollbar { width: 6px; }
.tm-ac-hist-filter-list::-webkit-scrollbar-thumb { background: #3a3a3d; border-radius: 3px; }
.tm-ac-hist-filter-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 13px; color: #efeff1; cursor: pointer; transition: background 0.15s; }
.tm-ac-hist-filter-item:hover { background: #2f2f35; }
.tm-ac-hist-filter-item.selected { background: #9147ff; }
#tm-ac-history-list { display: flex; flex-direction: column; gap: 6px; }
#tm-ac-history-list::-webkit-scrollbar { width: 6px; }
#tm-ac-history-list::-webkit-scrollbar-thumb { background: #3a3a3d; border-radius: 3px; }
.tm-ac-hist-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: #0e0e10; border: 1px solid #2f2f35; border-radius: 8px; cursor: grab; transition: border-color .15s, background .15s, opacity .15s; }
.tm-ac-hist-item:active { cursor: grabbing; }
.tm-ac-hist-item.dragging { opacity: 0.4; }
.tm-ac-hist-item.drag-over { border-top: 3px solid #9147ff; margin-top: -3px; }
.tm-ac-hist-item:hover { border-color: #9147ff; background: #1a1a1d; }
.tm-ac-hist-item.pinned { border-color: #bf94ff; background: rgba(145, 71, 255, 0.08); }
.tm-ac-hist-channel { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #adadb8; margin-bottom: 4px; cursor: pointer; transition: color 0.2s; position: relative; }
.tm-ac-hist-channel:hover { color: #efeff1; }
.tm-ac-hist-text { font-size: 12px; line-height: 1.6; color: #c8c8d0; max-height: 60px; overflow: hidden; word-break: break-word; pointer-events: none; }
.tm-ac-hist-text img.tm-emote { height: 22px; width: auto; vertical-align: middle; margin: 0 1px; display: inline-block; }
.tm-ac-hist-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #6b6b70; }
.tm-ac-hist-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.tm-ac-hist-btn { background: #2f2f35; border: none; color: #efeff1; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: background .15s, opacity .15s; touch-action: none; }
.tm-ac-hist-btn:hover { background: #9147ff; }
.tm-ac-hist-btn.pin.active { background: #9147ff; color: #fff; }
.tm-ac-hist-btn.preview.active { background: #9147ff; color: #fff; }
.tm-ac-hist-btn.send { user-select: none; }
.tm-ac-hist-btn.send:hover { background: #00a865; }
.tm-ac-hist-btn.delete { user-select: none; }
.tm-ac-hist-btn.delete:hover { background: #e91916; }
.tm-ac-hist-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tm-ac-hist-empty { text-align: center; padding: 30px 10px; color: #6b6b70; font-size: 13px; }
#tm-preview-container { display: flex; flex-direction: column; padding: 4px 10px; width: 100%; }
.tm-preview-msg { position: relative; margin: 2px 0; padding: 8px 28px 8px 10px; background: #18181b; border-left: 3px solid #9147ff; border-radius: 4px; font-size: 13px; line-height: 1.45; color: #efeff1; animation: tmPreviewIn 0.2s ease; box-shadow: 0 2px 10px rgba(0,0,0,0.5); word-break: break-word; }
.tm-preview-msg.tm-live-preview { border-left-color: #00f593; background: #1a2421; }
.tm-preview-msg .tm-preview-badge { display: inline-block; background: #9147ff; color: #fff; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
.tm-preview-msg.tm-live-preview .tm-preview-badge { background: #00c974; }
.tm-preview-msg .tm-preview-user { font-weight: 700; color: #bf94ff; margin-right: 2px; }
.tm-preview-msg.tm-live-preview .tm-preview-user { color: #00f593; }
.tm-preview-msg img.tm-emote { height: 28px; width: auto; vertical-align: middle; margin: 0 1px; }
.tm-preview-msg .tm-preview-close { position: absolute; top: 3px; right: 6px; background: transparent; border: none; color: #adadb8; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 4px; }
.tm-preview-msg .tm-preview-close:hover { color: #fff; }
@keyframes tmPreviewIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.tm-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 999999; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.2s; }
.tm-modal-overlay.open { opacity: 1; visibility: visible; }
.tm-modal { background: #18181b; border: 1px solid #2f2f35; border-radius: 8px; width: 320px; padding: 20px; color: #efeff1; font-family: Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif; box-shadow: 0 8px 32px rgba(0,0,0,0.5); transform: scale(0.9); transition: transform 0.2s; }
.tm-modal-overlay.open .tm-modal { transform: scale(1); }
.tm-modal-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.tm-modal-text { font-size: 13px; color: #adadb8; margin-bottom: 20px; line-height: 1.5; }
.tm-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.tm-modal-btn { padding: 8px 16px; border-radius: 4px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: background 0.15s; }
.tm-modal-btn.cancel { background: #2f2f35; color: #efeff1; }
.tm-modal-btn.cancel:hover { background: #3a3a3d; }
.tm-modal-btn.confirm { background: #e91916; color: #fff; }
.tm-modal-btn.confirm:hover { background: #ff4d4d; }
#tm-edit-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000000; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: opacity 0.2s; }
#tm-edit-modal.open { opacity: 1; visibility: visible; }
#tm-edit-modal .tm-edit-content { background: #18181b; border: 1px solid #2f2f35; border-radius: 12px; width: 800px; max-width: 90vw; height: 80vh; display: flex; flex-direction: column; box-shadow: 0 12px 48px rgba(0,0,0,0.8); overflow: hidden; }
#tm-edit-modal .tm-edit-header { padding: 16px 20px; border-bottom: 1px solid #2f2f35; background: #0e0e10; display: flex; justify-content: space-between; align-items: center; }
#tm-edit-modal .tm-edit-header h3 { margin: 0; font-size: 16px; color: #bf94ff; }
#tm-edit-modal .tm-edit-body { padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
#tm-edit-modal .tm-edit-textarea { width: 100%; min-height: 150px; flex: 1; background: #0e0e10; border: 1px solid #2f2f35; border-radius: 8px; color: #efeff1; padding: 12px; font-size: 14px; line-height: 1.5; resize: vertical; outline: none; font-family: inherit; }
#tm-edit-modal .tm-edit-textarea:focus { border-color: #9147ff; }
#tm-edit-modal .tm-variant-row { display: flex; gap: 10px; align-items: flex-start; }
#tm-edit-modal .tm-edit-actions { padding: 16px 20px; border-top: 1px solid #2f2f35; background: #0e0e10; display: flex; justify-content: space-between; align-items: center; }
#tm-edit-modal .tm-edit-btn { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
#tm-edit-modal .tm-edit-btn.save { background: #00a865; color: #fff; }
#tm-edit-modal .tm-edit-btn.add { background: #2f2f35; color: #fff; }
#tm-edit-modal .tm-edit-btn.cancel { background: #2f2f35; color: #adadb8; }
#tm-emote-picker-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000001; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: opacity 0.2s; }
#tm-emote-picker-modal.open { opacity: 1; visibility: visible; }
#tm-emote-picker-modal .tm-ep-content { background: #18181b; border: 1px solid #2f2f35; border-radius: 12px; width: 500px; max-width: 90vw; height: 600px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 12px 48px rgba(0,0,0,0.8); }
#tm-emote-picker-modal .tm-ep-header { padding: 12px 16px; border-bottom: 1px solid #2f2f35; display: flex; gap: 10px; align-items: center; }
#tm-emote-picker-modal input { flex: 1; background: #0e0e10; border: 1px solid #2f2f35; border-radius: 6px; color: #efeff1; padding: 8px 12px; font-size: 13px; outline: none; }
#tm-emote-picker-modal input:focus { border-color: #9147ff; }
#tm-emote-picker-modal .tm-ep-close { background: transparent; border: none; color: #adadb8; font-size: 20px; cursor: pointer; }
#tm-emote-picker-modal .tm-ep-close:hover { color: #fff; }
#tm-emote-picker-modal .tm-ep-list { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; }
#tm-emote-picker-modal .tm-ep-list::-webkit-scrollbar { width: 6px; }
#tm-emote-picker-modal .tm-ep-list::-webkit-scrollbar-thumb { background: #3a3a3d; border-radius: 3px; }
#tm-emote-picker-modal img { width: 48px; height: 48px; object-fit: contain; cursor: pointer; border-radius: 6px; padding: 4px; transition: background 0.15s; }
#tm-emote-picker-modal img:hover { background: #2f2f35; }
#tm-autochat-panel .tm-ac-header { padding: 12px 14px; background: linear-gradient(115deg, #17171b 0%, #101013 100%); border-bottom-color: #303038; }
#tm-autochat-panel .tm-ac-header-title { font-size: 14px; font-weight: 700; letter-spacing: .15px; }
#tm-autochat-panel .tm-ac-header-right { gap: 8px; }
#tm-autochat-panel .tm-ac-tabs { padding: 0 10px; background: #101013; }
#tm-autochat-panel .tm-ac-tab { padding: 12px 0 10px; font-weight: 600; }
#tm-autochat-panel .tm-ac-body { padding: 15px 14px 18px; }
#tm-tab-send { display: flex; flex-direction: column; gap: 13px; }
#tm-tab-send #tm-ac-msg { height: 164px; min-height: 164px; padding: 13px; background: #101013; border-color: #34343c; border-radius: 10px; font-size: 13px; line-height: 1.55; }
#tm-tab-send #tm-ac-msg:focus { border-color: #9147ff; box-shadow: 0 0 0 2px rgba(145,71,255,.13); }
.tm-ac-composer-tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: -7px; }
.tm-ac-composer-tools #tm-ac-char-count { margin: 0; font-variant-numeric: tabular-nums; }
.tm-ac-interval-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #101013; border: 1px solid #303038; border-radius: 10px; }
.tm-ac-interval-label { display: flex; flex-direction: column; gap: 3px; }
.tm-ac-interval-label strong { color: #efeff1; font-size: 13px; font-weight: 600; }
.tm-ac-interval-label small { color: #777782; font-size: 11px; }
.tm-ac-interval-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#tm-autochat-panel #tm-ac-interval { width: 76px; height: 36px; padding: 7px 9px; border-radius: 7px; background: #09090b; border-color: #3a3a43; font-variant-numeric: tabular-nums; }
.tm-ac-interval-unit { color: #92929d; font-size: 12px; }
.tm-ac-random-tag { position: relative; display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 9px; border: 1px solid rgba(145,71,255,.35); border-radius: 7px; background: rgba(145,71,255,.1); color: #d0b5ff; font-size: 11px; font-weight: 600; cursor: help; }
.tm-ac-random-tag::before { content: '↝'; font-size: 14px; line-height: 1; }
.tm-ac-random-tag[data-tooltip]::after { content: attr(data-tooltip); position: absolute; z-index: 30; left: 0; top: calc(100% + 8px); width: 230px; padding: 8px 10px; border: 1px solid #45454f; border-radius: 7px; background: #242428; color: #efeff1; font-size: 11px; font-weight: 400; line-height: 1.45; white-space: normal; opacity: 0; visibility: hidden; transform: translateY(-3px); transition: opacity .15s, transform .15s, visibility .15s; box-shadow: 0 6px 20px rgba(0,0,0,.45); pointer-events: none; }
.tm-ac-random-tag:hover::after, .tm-ac-random-tag:focus-visible::after { opacity: 1; visibility: visible; transform: translateY(0); }
.tm-ac-run-status { display: flex; align-items: center; gap: 11px; min-height: 72px; padding: 12px 13px; border: 1px solid #303038; border-radius: 10px; background: linear-gradient(120deg, #141418, #101013); transition: border-color .2s, background .2s; }
.tm-ac-run-status.running { border-color: rgba(0,245,147,.38); background: linear-gradient(120deg, rgba(0,245,147,.08), #101013 72%); }
.tm-ac-run-status.blocked { border-color: rgba(255,89,89,.4); background: linear-gradient(120deg, rgba(255,89,89,.08), #101013 72%); }
.tm-ac-run-status.paused { border-color: rgba(255,184,0,.4); background: linear-gradient(120deg, rgba(255,184,0,.07), #101013 72%); }
.tm-ac-run-indicator { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; background: #6b6b70; box-shadow: 0 0 0 4px rgba(107,107,112,.12); }
.tm-ac-run-status.running .tm-ac-run-indicator { background: #00f593; box-shadow: 0 0 0 4px rgba(0,245,147,.12); }
.tm-ac-run-status.blocked .tm-ac-run-indicator { background: #ff6262; box-shadow: 0 0 0 4px rgba(255,98,98,.12); }
.tm-ac-run-status.paused .tm-ac-run-indicator { background: #ffb800; box-shadow: 0 0 0 4px rgba(255,184,0,.12); }
.tm-ac-run-status-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.tm-ac-run-state { color: #efeff1; font-size: 13px; font-weight: 700; }
.tm-ac-run-detail { color: #858590; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.tm-ac-run-value { flex: 0 0 auto; color: #b9b9c2; font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.5px; }
.tm-ac-run-status.running .tm-ac-run-value { color: #00f593; }
.tm-ac-run-actions { display: flex; gap: 8px; }
.tm-ac-run-btn { display: flex; flex: 1; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 9px 14px; border: 1px solid transparent; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: filter .15s, transform .15s, opacity .15s; }
.tm-ac-run-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
.tm-ac-run-btn:disabled { opacity: .45; cursor: not-allowed; }
#tm-ac-start.tm-ac-run-btn { background: #087f54; border-color: #15996a; }
#tm-ac-stop.tm-ac-run-btn { background: #8e2929; border-color: #a63a3a; }
.tm-ac-run-note { margin-top: -5px; color: #777782; font-size: 11px; line-height: 1.45; text-align: center; }
.tm-ac-hist-item { gap: 8px; padding: 11px; border-color: #303038; background: #101013; }
.tm-ac-hist-item:hover { border-color: #7950b5; background: #17171c; }
.tm-ac-hist-topline { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.tm-ac-hist-channel { min-width: 0; margin: 0; color: #b4b4bf; }
.tm-ac-hist-channel span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-ac-variant-badge { display: inline-flex; flex: 0 0 auto; align-items: center; padding: 3px 7px; border: 1px solid rgba(145,71,255,.35); border-radius: 6px; background: rgba(145,71,255,.12); color: #d0b5ff; font-size: 10px; font-weight: 700; white-space: nowrap; }
.tm-ac-hist-text { max-height: 58px; color: #d0d0d8; font-size: 12px; }
.tm-ac-hist-meta { align-items: center; gap: 8px; margin-top: 2px; }
.tm-ac-hist-actions { display: flex; flex: 1; align-items: center; justify-content: space-between; gap: 7px; flex-wrap: nowrap; }
.tm-ac-hist-action-main, .tm-ac-hist-action-tools { display: flex; align-items: center; gap: 4px; }
.tm-ac-hist-action-tools { padding-left: 7px; border-left: 1px solid #35353d; }
.tm-ac-hist-btn { min-width: 29px; min-height: 29px; padding: 5px 8px; border: 1px solid #383840; background: #25252b; border-radius: 7px; }
.tm-ac-hist-action-tools .tm-ac-hist-btn { padding: 5px 7px; }
.tm-ac-hist-btn.use { padding: 5px 10px; background: rgba(145,71,255,.15); border-color: rgba(145,71,255,.25); color: #d5bdff; }
.tm-ac-hist-btn.use:hover { background: #6535a8; color: #fff; }
.tm-ac-hist-btn[data-tooltip] { position: relative; }
.tm-ac-hist-btn[data-tooltip]::after { content: attr(data-tooltip); position: absolute; z-index: 50; left: 50%; bottom: calc(100% + 8px); max-width: 220px; width: max-content; padding: 7px 9px; border: 1px solid #45454f; border-radius: 7px; background: #242428; color: #efeff1; font-size: 11px; font-weight: 500; line-height: 1.35; white-space: normal; text-align: center; opacity: 0; visibility: hidden; transform: translate(-50%, 3px); transition: opacity .14s, transform .14s, visibility .14s; pointer-events: none; box-shadow: 0 5px 16px rgba(0,0,0,.45); }
.tm-ac-hist-action-tools .tm-ac-hist-btn[data-tooltip]::after { left: auto; right: 0; transform: translateY(3px); }
.tm-ac-hist-btn[data-tooltip]:hover::after, .tm-ac-hist-btn[data-tooltip]:focus-visible::after { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
.tm-ac-hist-action-tools .tm-ac-hist-btn[data-tooltip]:hover::after, .tm-ac-hist-action-tools .tm-ac-hist-btn[data-tooltip]:focus-visible::after { transform: translateY(0); }
.tm-ac-hist-btn.delete:hover { background: #a83232; }
.tm-ac-section-title { margin: 17px 0 9px !important; padding-bottom: 7px; border-bottom: 1px solid #303038; color: #c5a6ff !important; letter-spacing: .2px; }
#tm-autochat-panel .tm-ac-check { align-items: flex-start; gap: 10px; margin: 8px 0; padding: 10px 11px; border: 1px solid #2d2d35; border-radius: 8px; background: #111114; }
#tm-autochat-panel .tm-ac-check input { flex: 0 0 16px; margin: 2px 0 0; }
.tm-ac-check-copy { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; color: #e1e1e7; font-size: 12px; font-weight: 600; line-height: 1.35; }
.tm-ac-check-copy small { color: #858590; font-size: 11px; font-weight: 400; line-height: 1.45; }
#tm-ac-spoiler-never-row.locked { opacity: .45; }
#tm-edit-modal .tm-edit-content { width: 720px; max-width: 92vw; max-height: 86vh; height: auto; min-height: 430px; border-color: #3a3a43; }
#tm-edit-modal .tm-edit-header { padding: 15px 18px; }
#tm-edit-modal .tm-edit-header h3 { color: #e0ccff; font-size: 15px; }
.tm-edit-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tm-edit-subtitle { color: #858590; font-size: 11px; line-height: 1.4; }
#tm-edit-modal .tm-edit-body { padding: 15px 18px; gap: 11px; }
#tm-edit-modal .tm-variant-row { display: flex; flex-direction: column; gap: 9px; padding: 12px; border: 1px solid #34343c; border-radius: 9px; background: #111114; }
.tm-variant-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tm-variant-title { color: #d9c4ff; font-size: 12px; font-weight: 700; }
.tm-variant-count { color: #777782; font-size: 10px; font-variant-numeric: tabular-nums; }
.tm-variant-count.over { color: #ff6262; }
.tm-variant-content { display: flex; align-items: stretch; gap: 9px; }
#tm-edit-modal .tm-edit-textarea { min-height: 108px; height: 108px; padding: 11px; border-color: #363640; border-radius: 8px; background: #0b0b0e; font-size: 13px; }
#tm-edit-modal .tm-edit-textarea:focus { border-color: #9147ff; box-shadow: 0 0 0 2px rgba(145,71,255,.12); }
.tm-variant-tools { display: flex; flex: 0 0 112px; flex-direction: column; gap: 7px; }
.tm-variant-tools .tm-edit-btn { min-height: 36px; padding: 7px 8px !important; border: 1px solid #3a3a43; border-radius: 7px; font-size: 11px !important; white-space: nowrap; }
.tm-variant-tools .add-emote-btn { background: #282431; color: #d8c6ff; }
.tm-variant-tools .add-emote-btn:hover { background: #3a2d50; }
.tm-variant-tools .remove-btn { background: #282124; color: #ffaaaa; }
.tm-variant-tools .remove-btn:hover:not(:disabled) { background: #6d2929; color: #fff; }
.tm-variant-tools .remove-btn:disabled { opacity: .35; cursor: not-allowed; }
#tm-edit-modal .tm-edit-actions { padding: 12px 18px; }
#tm-edit-modal .tm-edit-btn.save { background: #087f54; }
#tm-edit-modal .tm-edit-btn.add { background: #29252f; color: #d9c4ff; border: 1px solid #4a3b60; }
#tm-edit-modal .tm-edit-btn.cancel { border: 1px solid #373740; }
@media (max-width: 560px) { #tm-edit-modal .tm-edit-content { width: 94vw; min-height: 0; } #tm-edit-modal .tm-edit-body { padding: 12px; } .tm-variant-content { flex-direction: column; } .tm-variant-tools { flex: 0 0 auto; flex-direction: row; width: 100%; } .tm-variant-tools .tm-edit-btn { flex: 1; } .tm-ac-hist-action-tools { gap: 2px; padding-left: 5px; } .tm-ac-hist-action-tools .tm-ac-hist-btn { padding: 5px; } }
#tm-autochat-panel #tm-tab-send.active { display: flex; }
#tm-autochat-panel .tm-ac-header-btn { width: auto; min-width: 57px; height: 28px; padding: 0 8px; gap: 5px; border: 1px solid #3d3d46; border-radius: 7px; font-size: 11px; font-weight: 700; white-space: nowrap; }
#tm-autochat-panel .tm-ac-header-btn.start::after { content: 'Старт'; }
#tm-autochat-panel .tm-ac-header-btn.stop::after { content: 'Стоп'; }
#tm-autochat-panel .tm-ac-header-btn.start { background: rgba(0,168,101,.14); border-color: rgba(0,168,101,.38); color: #45e0a1; }
#tm-autochat-panel .tm-ac-header-btn.start:hover { background: #087f54; color: #fff; }
#tm-autochat-panel .tm-ac-header-btn.stop { background: rgba(233,25,22,.12); border-color: rgba(233,25,22,.35); color: #ff8a88; }
#tm-autochat-panel .tm-ac-header-btn.stop:hover { background: #a83232; color: #fff; }
#tm-autochat-panel .tm-ac-header-btn:focus-visible, #tm-autochat-toggle:focus-visible { outline: 2px solid #bf94ff; outline-offset: 2px; }
@media (max-width: 420px) { #tm-autochat-panel .tm-ac-header { gap: 6px; padding: 9px 8px; } #tm-autochat-panel .tm-ac-header-right { gap: 4px; } #tm-autochat-panel .tm-ac-header-title { font-size: 12px; } #tm-autochat-panel .tm-ac-header-btn { min-width: 51px; padding: 0 6px; } #tm-autochat-panel .tm-ac-status-pill { padding: 4px 5px; font-size: 10px; } }
#tm-autochat-panel, #tm-autochat-panel * { box-sizing: border-box; }
#tm-autochat-panel { width: min(380px, 100vw); max-width: 100vw; }
#tm-autochat-panel .tm-ac-body { min-width: 0; max-width: 100%; overflow-y: auto; overflow-x: hidden; }
#tm-autochat-panel .tm-ac-tab-content { width: 100%; max-width: 100%; min-width: 0; }
#tm-autochat-panel #tm-tab-send.active { display: flex; flex-direction: column; width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
#tm-autochat-panel #tm-tab-send > * { max-width: 100%; min-width: 0; }
#tm-autochat-panel #tm-tab-send textarea { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
#tm-autochat-panel .tm-ac-interval-card { width: 100%; max-width: 100%; min-width: 0; }
#tm-autochat-panel .tm-ac-interval-control { position: relative; width: 100%; max-width: 100%; min-width: 0; }
#tm-autochat-panel .tm-ac-random-tag { position: static; max-width: 100%; min-width: 0; }
#tm-autochat-panel .tm-ac-random-tag[data-tooltip]::after { left: auto; right: 0; top: auto; bottom: calc(100% + 8px); width: min(230px, 100%); max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; white-space: normal; }
#tm-edit-modal .tm-edit-content { box-sizing: border-box; width: min(720px, 94vw); max-width: 94vw; }
#tm-edit-modal .tm-edit-body { box-sizing: border-box; width: 100%; min-width: 0; }
#tm-edit-modal .tm-variant-row { box-sizing: border-box; width: 100%; min-width: 0; }
#tm-edit-modal .tm-variant-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; width: 100%; min-width: 0; }
#tm-edit-modal .tm-variant-heading { display: flex; align-items: center; gap: 9px; flex: 1 1 auto; min-width: 0; }
#tm-edit-modal .tm-variant-tools { display: flex; flex: 0 0 auto; flex-direction: row; align-items: center; gap: 6px; width: auto; min-width: 0; }
#tm-edit-modal .tm-variant-tools .tm-edit-btn { flex: 0 0 auto; min-height: 30px; padding: 6px 9px !important; }
#tm-edit-modal .tm-edit-textarea { display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 145px; height: 145px; flex: none; box-sizing: border-box; resize: vertical; }
#tm-edit-modal .tm-variant-content { display: block; width: 100%; min-width: 0; }
.tm-ac-followers-status { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 10px 12px; border: 1px solid rgba(255,184,0,.35); border-radius: 9px; background: rgba(255,184,0,.08); color: #f0d18a; }
.tm-ac-followers-status[hidden] { display: none !important; }
.tm-ac-followers-icon { display: flex; flex: 0 0 20px; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; background: rgba(255,184,0,.16); color: #ffc85c; font-size: 12px; font-weight: 800; }
.tm-ac-followers-copy { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.tm-ac-followers-copy strong { color: #f2d99f; font-size: 12px; line-height: 1.35; }
.tm-ac-followers-copy small { color: #b6a47e; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.tm-ac-followers-copy #tm-ac-followers-source { color: #9d8c69; }
@media (max-width: 560px) { #tm-edit-modal .tm-variant-tools { flex: 0 0 auto; flex-direction: row; width: auto; } #tm-edit-modal .tm-variant-tools .tm-edit-btn { flex: 0 0 auto; } #tm-edit-modal .tm-edit-textarea { width: 100%; min-height: 130px; height: 130px; } }
        `;
        document.head.appendChild(style);
    }
    function applySpoilerSettings() {
        const s = getSettings(); const off = !s.spoilerEnabled; const neverReveal = s.spoilerEnabled && s.spoilerNeverReveal;
        document.body.classList.toggle('tm-spoiler-off', off);
        document.body.classList.toggle('tm-spoiler-never-reveal', neverReveal);
        if (off || neverReveal) {
            document.querySelectorAll('.tm-spoiler-target.tm-revealed').forEach(t => t.classList.remove('tm-revealed'));
        }
    }
    function setupSpoilers() {
        if (!getSettings().spoilerEnabled) return;
        document.querySelectorAll('[data-test-selector="channel_panel_test_selector"] img').forEach(img => {
            if (img.dataset.tmSpoilerInit) return;
            img.dataset.tmSpoilerInit = 'true';
            let wrap = img.parentElement;
            if (!wrap.classList.contains('tm-spoiler-target')) {
                wrap = document.createElement('div');
                wrap.className = 'tm-spoiler-target';
                if (img.parentNode) {
                    img.parentNode.insertBefore(wrap, img);
                    wrap.appendChild(img);
                }
            }
            img.classList.add('tm-spoiler-img');
            wrap.addEventListener('mouseenter', () => {
                if (document.body.classList.contains('tm-spoiler-off') || document.body.classList.contains('tm-spoiler-never-reveal')) return;
                wrap.classList.add('tm-revealed');
            });
            wrap.addEventListener('mouseleave', () => wrap.classList.remove('tm-revealed'));
        });
    }
    const emoteMap = new Map(); const channelEmoteNames = new Set(); let globalEmotesLoaded = false;
    function collectEmotes() {
        let changed = false;
        const selectors = [
            'img.seventv-chat-emote',
            'img[class*="seventv"][alt]',
            'img[data-emote-name]',
            'img.chat-image[alt]',
            'img.chat-line__message--emote'
        ].join(',');
        document.querySelectorAll(selectors).forEach(img => {
            const name = (img.getAttribute('alt') || img.getAttribute('data-emote-name') || '').trim();
            if (!name || name.length > 40) return;
            const src = img.currentSrc || img.src || img.getAttribute('data-src') || ''; const srcset = img.getAttribute('srcset') || '';
            if (!src && !srcset) return;
            const existing = emoteMap.get(name);
            if (existing) {
                const existingScore = (existing.src ? 1 : 0) + (existing.srcset ? 1 : 0); const newScore = (src ? 1 : 0) + (srcset ? 1 : 0);
                if (existingScore >= newScore) return;
            }
            emoteMap.set(name, { src, srcset });
            changed = true;
        });
        if (changed) {
            try { document.dispatchEvent(new CustomEvent('tm-emotes-updated')); } catch {}
        }
    }
    function addSevenTVEmotes(emotes, isChannel = false) {
        if (!Array.isArray(emotes)) return false;
        let changed = false;
        for (const e of emotes) {
            if (!e || !e.name || !e.id) continue;
            const name = e.name;
            if (name.length > 40) continue;
            const existing = emoteMap.get(name);
            if (existing && !isChannel) continue;
            if (existing && existing.src && existing.src.includes(e.id)) continue;
            const base = `https://cdn.7tv.app/emote/${e.id}`;
            emoteMap.set(name, {
                src: `${base}/2x.webp`,
                srcset: `${base}/1x.webp 1x, ${base}/2x.webp 2x, ${base}/3x.webp 3x, ${base}/4x.webp 4x`
            });
            if (isChannel) channelEmoteNames.add(name);
            changed = true;
        }
        return changed;
    }
    async function getTwitchUserId(login) {
        if (!login) return null;
        try {
            const res = await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(login)}`);
            if (res.ok) {
                const id = (await res.text()).trim();
                if (/^\d+$/.test(id)) return id;
            }
        } catch {}
        try {
            const res = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0 && data[0].id) return String(data[0].id);
            }
        } catch {}
        return null;
    }
    async function fetchSevenTVEmotes(channelLogin) {
        if (!channelLogin || ['directory', 'popout', 'videos', 'settings'].includes(channelLogin)) return;
        let changed = false;
        if (!globalEmotesLoaded) {
            try {
                const res = await fetch('https://7tv.io/v3/emote-sets/global');
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.emotes && addSevenTVEmotes(data.emotes, false)) {
                        changed = true;
                        globalEmotesLoaded = true;
                    }
                }
            } catch {}
        }
        try {
            const twitchId = await getTwitchUserId(channelLogin);
            if (twitchId) {
                const res = await fetch(`https://7tv.io/v3/users/twitch/${encodeURIComponent(twitchId)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.emote_set && Array.isArray(data.emote_set.emotes)) {
                        if (addSevenTVEmotes(data.emote_set.emotes, true)) changed = true;
                    }
                }
            }
        } catch {}
        if (changed) {
            try { document.dispatchEvent(new CustomEvent('tm-emotes-updated')); } catch {}
        }
    }
    collectEmotes();
    (async () => {
        const parts = window.location.pathname.split('/').filter(Boolean);
        if (parts.length > 0 && !['directory', 'popout', 'videos', 'settings'].includes(parts[0])) {
            await fetchSevenTVEmotes(parts[0].toLowerCase());
        }
    })();
    function renderEmotes(text) {
        if (!text) return '';
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const names = Array.from(emoteMap.keys()).sort((a, b) => b.length - a.length);
        for (const name of names) {
            const data = emoteMap.get(name);
            if (!data || (!data.src && !data.srcset)) continue;
            const safeName = name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            const imgTag = data.srcset
                ? `<img class="tm-emote seventv-chat-emote" srcset="${data.srcset}" alt="${safeName}" loading="lazy">`
                : `<img class="tm-emote seventv-chat-emote" src="${data.src}" alt="${safeName}" loading="lazy">`;
            const re = new RegExp(`(^|\\s)${escapeRegExp(name)}(?=\\s|$)`, 'g');
            html = html.replace(re, `$1${imgTag}`);
        }
        return html;
    }
    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function getCurrentUsername() {
        try {
            const cookies = document.cookie.split(';').map(c => c.trim());
            for (const c of cookies) {
                if (c.startsWith('login=')) return decodeURIComponent(c.split('=')[1]);
                if (c.startsWith('name=')) return decodeURIComponent(c.split('=')[1]);
            }
        } catch {}
        const nameEl = document.querySelector('[data-a-target="user-display-name"]') || document.querySelector('[data-a-target="user-menu-toggle"]');
        if (nameEl) {
            const txt = (nameEl.textContent || nameEl.getAttribute('aria-label') || '').trim();
            if (txt && txt.length < 30) return txt;
        }
        return null;
    }
    function getChannelInfo() {
        let channelName = ''; const parts = window.location.pathname.split('/').filter(Boolean);
        if (parts.length > 0 && !['directory', 'popout', 'videos', 'settings'].includes(parts[0])) {
            channelName = parts[0].toLowerCase();
        }
        let displayName = channelName; const nameEl = document.querySelector('[data-a-target="channel-info"] h1, h1[data-test-selector="channel-header-title"], .channel-info-content h1');
        if (nameEl && nameEl.textContent.trim()) {
            displayName = nameEl.textContent.trim();
        }
        return { name: channelName, displayName, avatar: getAvatarUrl(channelName) };
    }
    function getAvatarUrl(name) {
        if (name && name !== 'unknown' && name !== 'all') {
            const userEl = document.querySelector(`[data-a-user="${name.toLowerCase()}"]`);
            if (userEl) {
                const img = userEl.querySelector('img');
                if (img && img.src) return img.src;
            }
            const sidebarLinks = document.querySelectorAll('a[href="/' + name + '"]');
            for (let link of sidebarLinks) {
                const img = link.querySelector('img');
                if (img && img.src) return img.src;
            }
            return `https://unavatar.io/twitch/${encodeURIComponent(name)}`;
        }
        return 'https://static-cdn.jtvnw.net/user-default-pictures-uv/215b7342-def9-11e9-9a66-784f43822e80-profile_image-70x70.png';
    }
    function renderAvatar(name, size = 16) {
        const url = getAvatarUrl(name); const fallback = 'https://static-cdn.jtvnw.net/user-default-pictures-uv/215b7342-def9-11e9-9a66-784f43822e80-profile_image-70x70.png';
        return `<img src="${url}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.onerror=null;this.src='${fallback}';">`;
    }
    function findChatInput() { return document.querySelector('div[data-a-target="chat-input"]'); }
    function findSendButton() { return document.querySelector('button[data-a-target="chat-send-button"]'); }
    function getChatRestriction() {
        const chatArea = document.querySelector('.chat-input') || document.querySelector('[data-a-target="chat-input"]')?.closest('.chat-input') || document.querySelector('.chat-room') || document.body; const allText = (chatArea.innerText || '').toLowerCase();
        if (/временно отстранен|отстранены от чата|временно отстранить/.test(allText)) {
            const timeMatch = allText.match(/через\s+(\d+)\s*минут[уы]?\s*(\d+)?\s*секунд?/i) || allText.match(/через\s+(\d+)\s*секунд/i); let remaining = '';
            if (timeMatch) {
                remaining = timeMatch[2] !== undefined ? `${timeMatch[1]} мин ${timeMatch[2]} сек` : (timeMatch[0].includes('секунд') ? `${timeMatch[1]} сек` : `${timeMatch[1]} мин`);
            }
            return { type: 'timeout', message: remaining ? `Вы временно отстранены\nОсталось: ${remaining}` : 'Вы временно отстранены от чата' };
        }
        if (/you are timed out|timed out from chat/i.test(allText)) return { type: 'timeout', message: 'You are timed out' };
        if (/вы забанены|you are banned|banned from this channel/i.test(allText)) return { type: 'ban', message: 'Вы забанены в этом чате' };
        return null;
    }
    function formatFollowersDuration(durationText) {
        const units = /(\d+)\s*(weeks?|wks?|недел(?:я|и|ю|ь|ей)?|months?|mos?|месяц(?:а|ев)?|days?|день|дня|дней|hours?|hrs?|час(?:а|ов)?|minutes?|mins?|минут(?:а|ы)?|seconds?|secs?|секунд(?:а|ы)?)/gi;
        const labels = {
            week: ['неделя', 'недели', 'недель'],
            month: ['месяц', 'месяца', 'месяцев'],
            day: ['день', 'дня', 'дней'],
            hour: ['час', 'часа', 'часов'],
            minute: ['минута', 'минуты', 'минут'],
            second: ['секунда', 'секунды', 'секунд']
        };
        const plural = (value, forms) => {
            const n = value % 100; const last = value % 10;
            return n >= 11 && n <= 14 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
        };
        const parts = [];
        for (const match of durationText.matchAll(units)) {
            const value = parseInt(match[1], 10); const unit = match[2].toLowerCase();
            let key = '';
            if (/week|wk|недел/.test(unit)) key = 'week';
            else if (/month|mo|месяц/.test(unit)) key = 'month';
            else if (/day|день|дня|дней/.test(unit)) key = 'day';
            else if (/hour|hr|час/.test(unit)) key = 'hour';
            else if (/minute|min|минут/.test(unit)) key = 'minute';
            else if (/second|sec|секунд/.test(unit)) key = 'second';
            if (key && value > 0) parts.push(`${value} ${plural(value, labels[key])}`);
        }
        return parts.join(' ');
    }
    function extractFollowersMessage(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('button, [role="button"], a, input, textarea, [contenteditable="true"], svg, img, [aria-hidden="true"], [class*="button"], [data-a-target*="follow"]').forEach(node => node.remove());
        return (clone.innerText || clone.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function parseFollowersDurationSeconds(durationText) {
        const units = /(\d+)\s*(weeks?|wks?|недел(?:я|и|ю|ь|ей)?|months?|mos?|месяц(?:а|ев)?|days?|день|дня|дней|hours?|hrs?|час(?:а|ов)?|minutes?|mins?|минут(?:а|ы)?|seconds?|secs?|секунд(?:а|ы)?)/gi;
        let total = 0;
        for (const match of String(durationText || '').matchAll(units)) {
            const value = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            if (/week|wk|недел/.test(unit)) total += value * 604800;
            else if (/month|mo|месяц/.test(unit)) total += value * 2592000;
            else if (/day|день|дня|дней/.test(unit)) total += value * 86400;
            else if (/hour|hr|час/.test(unit)) total += value * 3600;
            else if (/minute|min|минут/.test(unit)) total += value * 60;
            else if (/second|sec|секунд/.test(unit)) total += value;
        }
        return total > 0 ? total : null;
    }
    function formatFollowersSeconds(totalSeconds) {
        let left = Math.max(0, Math.ceil(totalSeconds));
        const labels = {
            month: ['месяц', 'месяца', 'месяцев'],
            week: ['неделя', 'недели', 'недель'],
            day: ['день', 'дня', 'дней'],
            hour: ['час', 'часа', 'часов'],
            minute: ['минута', 'минуты', 'минут'],
            second: ['секунда', 'секунды', 'секунд']
        };
        const plural = (value, forms) => {
            const n = value % 100;
            const last = value % 10;
            return n >= 11 && n <= 14 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
        };
        const units = [
            ['month', 2592000],
            ['week', 604800],
            ['day', 86400],
            ['hour', 3600],
            ['minute', 60],
            ['second', 1]
        ];
        const parts = [];
        for (const [key, size] of units) {
            const value = Math.floor(left / size);
            if (value > 0) {
                parts.push(value + ' ' + plural(value, labels[key]));
                left -= value * size;
            }
        }
        return parts.join(' ') || '0 секунд';
    }
    function findCollapsedFollowersBanner(chatInput) {
        const phrase = /(?:чат\s+только\s+для\s+(?:фолловеров|подписчиков)|followers?[-\s]+only(?:\s+chat)?|chat\s+is\s+followers?[-\s]+only)/i;
        const candidates = new Set();
        const collect = root => {
            if (!root || root.nodeType !== 1) return;
            candidates.add(root);
            root.querySelectorAll('p, span, div, [data-a-target], [data-test-selector], [role="alert"]').forEach(node => candidates.add(node));
        };
        const scope = chatInput?.closest('.chat-input') || chatInput?.parentElement?.parentElement || chatInput?.parentElement;
        if (scope) collect(scope);
        let current = chatInput;
        let depth = 0;
        while (current && current.parentElement && depth++ < 8) {
            const parent = current.parentElement;
            let sibling = current.previousElementSibling;
            let count = 0;
            while (sibling && count++ < 4) {
                collect(sibling);
                sibling = sibling.previousElementSibling;
            }
            sibling = current.nextElementSibling;
            count = 0;
            while (sibling && count++ < 2) {
                collect(sibling);
                sibling = sibling.nextElementSibling;
            }
            current = parent;
        }
        const matches = [];
        for (const element of candidates) {
            if (!element.isConnected) continue;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || !element.getClientRects().length) continue;
            const text = (element.innerText || element.textContent || element.getAttribute('aria-label') || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (text && text.length <= 220 && phrase.test(text)) matches.push({ element, text });
        }
        matches.sort((a, b) => a.text.length - b.text.length);
        return matches[0] || null;
    }
    function requestFollowersBannerExpand(channelName, chatInput, banner) {
        if (!channelName || followersFocusAttempts.has(channelName)) return;
        let target = null;
        if (chatInput && chatInput.isConnected) {
            target = chatInput.matches('[contenteditable="true"], textarea, input, [role="textbox"]') ? chatInput : chatInput.querySelector('[contenteditable="true"], textarea, input, [role="textbox"], .chat-input__textarea') || chatInput;
        }
        if (!target || !target.isConnected || !target.getClientRects().length) target = banner?.element || null;
        if (!target || !target.isConnected || !target.getClientRects().length) return;
        followersFocusAttempts.add(channelName);
        const previousFocus = document.activeElement;
        const rect = target.getBoundingClientRect();
        const eventData = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0,
            buttons: 1,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        };
        try {
            if (typeof PointerEvent === 'function') target.dispatchEvent(new PointerEvent('pointerdown', eventData));
            else target.dispatchEvent(new MouseEvent('pointerdown', eventData));
            target.dispatchEvent(new MouseEvent('mousedown', eventData));
            if (typeof PointerEvent === 'function') target.dispatchEvent(new PointerEvent('pointerup', { ...eventData, buttons: 0 }));
            else target.dispatchEvent(new MouseEvent('pointerup', { ...eventData, buttons: 0 }));
            target.dispatchEvent(new MouseEvent('mouseup', { ...eventData, buttons: 0 }));
            if (typeof target.click === 'function') target.click();
        } catch {}
        setTimeout(() => {
            if (refreshFollowersOnlyStatus) refreshFollowersOnlyStatus();
            if (previousFocus && previousFocus !== document.body && previousFocus !== document.documentElement && previousFocus !== target && previousFocus.isConnected && (document.activeElement === target || target.contains(document.activeElement))) {
                try { previousFocus.focus({ preventScroll: true }); } catch { try { previousFocus.focus(); } catch {} }
            }
        }, 260);
        setTimeout(() => { if (refreshFollowersOnlyStatus) refreshFollowersOnlyStatus(); }, 650);
    }
    function getFollowersOnlyInfo() {
        const patterns = [
            /чат.{0,100}(?:только для фолловеров|только для подписчиков)/i,
            /для общения в чате.{0,120}(?:нужно|необходимо|требуется).{0,80}(?:фолловер|подписчик)/i,
            /(?:нужно|необходимо|требуется) быть (?:фолловером|подписчиком)/i,
            /только (?:фолловеры|подписчики)\b.{0,140}(?:чат|писать|отправлять сообщения|общаться)/i,
            /режим только для (?:фолловеров|подписчиков)/i,
            /followers?[-\s]only(?:\s+chat)?/i,
            /(?:to chat|chatting|participate in chat).{0,140}(?:must|need to|required to) follow/i,
            /(?:must|need to|required to) follow.{0,160}(?:chat|participat|send messages|for\s+\d)/i,
            /you must be following.{0,140}(?:chat|participat|send messages|\d)/i,
            /follow this channel.{0,140}(?:chat|send messages|chatting|\d)/i
        ];
        const unit = '(?:weeks?|wks?|недел(?:я|и|ю|ь|ей)?|months?|mos?|месяц(?:а|ев)?|days?|день|дня|дней|hours?|hrs?|час(?:а|ов)?|minutes?|mins?|минут(?:а|ы)?|seconds?|secs?|секунд(?:а|ы)?)';
        const sequence = '\\d+\\s*' + unit + '(?:\\s*(?:(?:,|and|и)\\s*)?\\d+\\s*' + unit + '){0,4}';
        const remainingPatterns = [
            new RegExp('(?:ждать|ожидать)\\s+осталось\\s*[:—-]?\\s*(' + sequence + ')', 'i'),
            new RegExp('осталось\\s*(?:ждать|ожидать)?\\s*[:—-]?\\s*(' + sequence + ')', 'i'),
            new RegExp('(?:remaining|time\\s+left|time\\s+remaining|left)\\s*[:—-]?\\s*(' + sequence + ')', 'i'),
            new RegExp('(' + sequence + ')\\s*(?:осталось|осталось ждать|remaining|left)\\b', 'i'),
            new RegExp('(?:wait|waiting)\\s+(?:for|another)?\\s*[:—-]?\\s*(' + sequence + ')', 'i'),
            new RegExp('(?:можно будет писать|сможете общаться|can chat|can send messages)\\s+(?:через|in)\\s*(' + sequence + ')', 'i')
        ];
        const requiredPatterns = [
            new RegExp('(?:нужно быть фолловером|нужно быть подписчиком|необходимо быть фолловером|необходимо быть подписчиком|требуется быть фолловером|требуется быть подписчиком)\\s*(' + sequence + ')', 'i'),
            new RegExp('(?:follow|following)\\s+(?:this\\s+channel\\s+)?for\\s+(' + sequence + ')', 'i'),
            new RegExp('(?:for at least|minimum follow(?:ing)? time\\s*[:—-]?)\\s*(' + sequence + ')', 'i')
        ];
        const selectors = '[data-a-target="chat-rules-banner"], [data-test-selector*="chat-rules"], [data-a-target*="followers-only"], [class*="chat-rules"], [class*="followers-only"], [role="alert"]';
        const chatInput = document.querySelector('[data-a-target="chat-input"]') || document.querySelector('.chat-input__textarea') || document.querySelector('.chat-input [contenteditable="true"]');
        const channelName = (getChannelInfo().name || window.location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
        const collapsedBanner = findCollapsedFollowersBanner(chatInput);
        const candidates = new Set(document.querySelectorAll(selectors));
        if (chatInput) {
            const area = chatInput.closest('.chat-input') || chatInput.parentElement?.parentElement || chatInput.parentElement;
            if (area) {
                area.querySelectorAll(selectors + ', p, span, div, [data-a-target], [data-test-selector]').forEach(node => candidates.add(node));
                let current = chatInput;
                let depth = 0;
                while (current && current.parentElement && depth++ < 8) {
                    const previous = current.previousElementSibling;
                    if (previous) {
                        candidates.add(previous);
                        previous.querySelectorAll(selectors + ', p, span, div, [data-a-target], [data-test-selector]').forEach(node => candidates.add(node));
                    }
                    current = current.parentElement;
                }
            }
        }
        if (collapsedBanner) candidates.add(collapsedBanner.element);
        const isFollowButton = element => {
            const label = [element.innerText, element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-a-target')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            return /^(?:follow(?:\s+(?:this\s+)?channel)?|отслеживать|подписаться)(?:\s|$)/i.test(label);
        };
        let best = null;
        let bestScore = -1;
        for (const element of candidates) {
            if (!element || !element.isConnected || element.matches('textarea, input, [contenteditable="true"], .chat-input__textarea, button')) continue;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || !element.getClientRects().length) continue;
            const bannerScope = element.closest('[data-a-target="chat-rules-banner"], [data-test-selector*="chat-rules"], [data-a-target*="followers-only"], [class*="chat-rules"], [class*="followers-only"], [role="alert"]') || element;
            const text = extractFollowersMessage(bannerScope);
            if (!text || text.length > 900) continue;
            const remainingMatch = remainingPatterns.map(pattern => text.match(pattern)).find(Boolean);
            const requiredMatch = requiredPatterns.map(pattern => text.match(pattern)).find(Boolean);
            const followerContext = patterns.some(pattern => pattern.test(text));
            if (!followerContext && !remainingMatch && !requiredMatch) continue;
            const controls = [];
            if (bannerScope.matches('button, [role="button"], a, [data-a-target*="follow"]')) controls.push(bannerScope);
            bannerScope.querySelectorAll('button, [role="button"], a, [data-a-target*="follow"]').forEach(control => controls.push(control));
            const followButton = controls.some(control => {
                const controlStyle = window.getComputedStyle(control);
                return controlStyle.display !== 'none' && controlStyle.visibility !== 'hidden' && control.getClientRects().length > 0 && isFollowButton(control);
            });
            const remainingRaw = remainingMatch ? remainingMatch[1] : '';
            const remaining = remainingRaw ? formatFollowersDuration(remainingRaw) : '';
            let required = requiredMatch ? formatFollowersDuration(requiredMatch[1]) : '';
            if (!required && !remaining) {
                const requiredMatchFallback = text.match(/(?:фолловером|подписчиком)\s+(\d+\s*(?:days?|день|дня|дней|weeks?|недел(?:я|и|ю|ь|ей)?))/i);
                if (requiredMatchFallback) required = formatFollowersDuration(requiredMatchFallback[1]);
            }
            const info = { text, remaining, required, notFollowing: followButton, channel: channelName };
            if (remainingRaw || required) {
                const previous = followersOnlyCache.get(channelName);
                const parsedSeconds = remainingRaw ? parseFollowersDurationSeconds(remainingRaw) : null;
                const sameReading = previous && previous.remainingRaw === remainingRaw && previous.remainingCapturedAt;
                followersOnlyCache.set(channelName, {
                    ...info,
                    remainingRaw,
                    remainingSeconds: parsedSeconds,
                    remainingCapturedAt: parsedSeconds === null ? 0 : (sameReading ? previous.remainingCapturedAt : Date.now())
                });
            }
            const score = (remaining ? 10000 : 0) + (required ? 5000 : 0) + (followButton ? 1000 : 0) + Math.min(text.length, 500);
            if (score > bestScore) {
                best = info;
                bestScore = score;
            }
        }
        const hasBanner = !!collapsedBanner || !!best;
        if (!hasBanner) {
            if (channelName) {
                followersOnlyCache.delete(channelName);
                followersFocusAttempts.delete(channelName);
            }
            return null;
        }
        const cached = followersOnlyCache.get(channelName);
        if (cached && (cached.remaining || cached.required)) {
            const result = { ...cached, notFollowing: !!best?.notFollowing };
            if (cached.remainingSeconds !== null && cached.remainingCapturedAt) {
                const elapsed = Math.max(0, (Date.now() - cached.remainingCapturedAt) / 1000);
                result.remaining = formatFollowersSeconds(cached.remainingSeconds - elapsed);
            }
            return result;
        }
        if (best?.notFollowing) return best;
        if (collapsedBanner) {
            requestFollowersBannerExpand(channelName, chatInput, collapsedBanner);
            return {
                text: best?.text || collapsedBanner.text,
                remaining: '',
                required: best?.required || '',
                notFollowing: false,
                channel: channelName
            };
        }
        return best;
    }
    function getSlowModeInfo() {
        const chatArea = document.querySelector('.chat-room') || document.querySelector('[data-test-selector="chat-room-component-layout"]') || document.body; const text = (chatArea.innerText || ''); const ruMatch = text.match(/медленный режим[^0-9]*(\d+)\s*секунд/i);
        if (ruMatch) return parseInt(ruMatch[1], 10);
        const enMatch = text.match(/slow mode[^0-9]*(\d+)\s*second/i);
        if (enMatch) return parseInt(enMatch[1], 10);
        return 0;
    }
    function addInvisibleChars(text) {
        if (!getSettings().antiSpamRandomizer) return text;
        const chars = ['\u200b', '\u200c', '\u200d', '\u2060']; const c = chars[Math.floor(Math.random() * chars.length)];
        return text + c + c;
    }
    async function sendChatMessage(text) {
        const restriction = getChatRestriction();
        if (restriction) return { ok: false, restriction };
        const input = findChatInput(); const btn = findSendButton();
        if (!input) return { ok: false, restriction: { type: 'noinput', message: 'Поле чата не найдено' } };
        const finalText = addInvisibleChars(text);
        input.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', finalText);
        input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        await new Promise(r => setTimeout(r, 200));
        if (btn && !btn.disabled) {
            btn.click();
            return { ok: true };
        }
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return { ok: true };
    }
    function getRandomDelay(baseSec) {
        const slowMode = getSlowModeInfo(); const actualBase = Math.max(baseSec, slowMode > 0 ? slowMode + 1 : 0); const variation = Math.max(0.8, actualBase * 0.35); const min = Math.max(1.5, actualBase - variation);
        const max = actualBase + variation;
        return (min + Math.random() * (max - min)) * 1000;
    }
    function playBeep() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const oscillator = audioCtx.createOscillator(); const gainNode = audioCtx.createGain();
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.3);
        } catch {}
    }
    let livePreviewEl = null; let historyPreviewEl = null; let currentTab = 'send'; let isRunning = false;
    let isPausedByUser = false; let isAutoSending = false; let currentFilter = 'all'; let lastKnownChannel = '';
    let activeHistoryIdx = -1; let currentEmoteTarget = null;
    function getChatList() {
        return document.querySelector('.seventv-chat-list') ||
               document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]') ||
               document.querySelector('.chat-scrollable-area__message-container') ||
               document.querySelector('.chat-list');
    }
    function getPreviewContainer() {
        let container = document.getElementById('tm-preview-container');
        if (container) return container;
        const chatList = getChatList();
        if (chatList) {
            container = document.createElement('div');
            container.id = 'tm-preview-container';
            chatList.appendChild(container);
            return container;
        }
        return null;
    }
    function removeLivePreview() {
        if (livePreviewEl) { livePreviewEl.remove(); livePreviewEl = null; }
        const container = document.getElementById('tm-preview-container');
        if (container) container.querySelectorAll('.tm-live-preview').forEach(el => el.remove());
    }
    function removeHistoryPreview() {
        if (historyPreviewEl) { historyPreviewEl.remove(); historyPreviewEl = null; }
        const container = document.getElementById('tm-preview-container');
        if (container) container.querySelectorAll('.tm-preview-msg:not(.tm-live-preview)').forEach(el => el.remove());
        document.querySelectorAll('.tm-ac-hist-btn.preview.active').forEach(b => b.classList.remove('active'));
    }
    function updateLivePreview(text, username) {
        const s = getSettings();
        if (!s.livePreview || currentTab !== 'send' || isRunning || !text.trim()) {
            removeLivePreview();
            return;
        }
        const container = getPreviewContainer();
        if (!container) return;
        const name = username || getCurrentUsername() || 'You';
        const html = `
            <span class="tm-preview-badge">LIVE</span>
            <span class="tm-preview-user">${escapeHtml(name)}</span>:
            <span class="tm-preview-body">${renderEmotes(text)}</span>
        `;
        if (livePreviewEl && livePreviewEl.isConnected) {
            livePreviewEl.innerHTML = html;
        } else {
            removeLivePreview();
            const el = document.createElement('div');
            el.className = 'tm-preview-msg tm-live-preview';
            el.innerHTML = html;
            container.appendChild(el);
            livePreviewEl = el;
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    function showHistoryPreview(text, username) {
        if (historyPreviewEl && historyPreviewEl.isConnected) {
            removeHistoryPreview();
            return false;
        }
        removeHistoryPreview();
        const container = getPreviewContainer();
        if (!container) return false;
        const name = username || getCurrentUsername() || 'You'; const el = document.createElement('div');
        el.className = 'tm-preview-msg';
        el.innerHTML = `
            <span class="tm-preview-badge">PREVIEW</span>
            <span class="tm-preview-user">${escapeHtml(name)}</span>:
            <span class="tm-preview-body">${renderEmotes(text)}</span>
            <button class="tm-preview-close" title="Закрыть">×</button>
        `;
        el.querySelector('.tm-preview-close').addEventListener('click', removeHistoryPreview);
        container.appendChild(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        historyPreviewEl = el;
        setTimeout(() => { if (historyPreviewEl === el) removeHistoryPreview(); }, 20000);
        return true;
    }
    function showConfirmModal(title, message, onConfirm) {
        let overlay = document.getElementById('tm-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tm-modal-overlay';
            overlay.className = 'tm-modal-overlay';
            overlay.innerHTML = `
                <div class="tm-modal">
                    <div class="tm-modal-title"></div>
                    <div class="tm-modal-text"></div>
                    <div class="tm-modal-actions">
                        <button class="tm-modal-btn cancel">Отмена</button>
                        <button class="tm-modal-btn confirm">OK</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        const titleEl = overlay.querySelector('.tm-modal-title'); const textEl = overlay.querySelector('.tm-modal-text'); const cancelBtn = overlay.querySelector('.cancel'); const confirmBtn = overlay.querySelector('.confirm');
        titleEl.textContent = title;
        textEl.textContent = message;
        overlay.classList.add('open');
        const close = () => {
            overlay.classList.remove('open');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };
        confirmBtn.onclick = () => { onConfirm(); close(); };
        cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }
    function createAutoChatUI() {
        if (document.getElementById('tm-autochat-panel')) return;
        const data = loadData(); const settings = getSettings(); const username = getCurrentUsername(); const toggleSidebarBtn = document.createElement('button');
        toggleSidebarBtn.id = 'tm-autochat-toggle-btn';
        toggleSidebarBtn.innerHTML = '◀';
        document.body.appendChild(toggleSidebarBtn);
        const panel = document.createElement('div');
        panel.id = 'tm-autochat-panel';
        panel.innerHTML = `
            <div class="tm-ac-header">
                <div class="tm-ac-header-left">
                    <span class="tm-ac-header-title">AutoChat ${username ? '• ' + username : ''}</span>
                </div>
                <div class="tm-ac-header-right">
                    <div class="tm-ac-status-pill slowmode" id="tm-ac-slowmode-pill" style="display:none">
                        <span class="tm-ac-status-dot"></span>
                        <span>КД: <span id="tm-ac-slowmode-text"></span>с</span>
                    </div>
                    <div class="tm-ac-status-pill" id="tm-ac-status">
                        <span class="tm-ac-status-dot"></span>
                        <span class="tm-ac-status-text">Стоп</span>
                    </div>
                    <button class="tm-ac-header-btn start" id="tm-ac-start" title="Запустить автоотправку" aria-label="Запустить автоотправку">▶</button>
                    <button class="tm-ac-header-btn stop" id="tm-ac-stop" style="display:none" title="Остановить автоотправку" aria-label="Остановить автоотправку">■</button>
                    <button id="tm-autochat-toggle" title="Закрыть">×</button>
                </div>
            </div>

            <div class="tm-ac-tabs">
                <div class="tm-ac-tab active" data-tab="send">Отправка</div>
                <div class="tm-ac-tab" data-tab="history">История</div>
                <div class="tm-ac-tab" data-tab="settings">Настройки</div>
            </div>

            <div class="tm-ac-body">
                <div class="tm-ac-tab-content active" id="tm-tab-send">
                    <textarea id="tm-ac-msg" placeholder="Введите сообщение или пасту..." maxlength="${MAX_CHARS}"></textarea>
                    <div class="tm-ac-composer-tools">
                        <button id="tm-ac-emotes-btn" class="tm-ac-hist-btn">😀 Смайлы</button>
                        <div id="tm-ac-char-count">0 / ${MAX_CHARS}</div>
                    </div>
                    <div class="tm-ac-interval-card">
                        <div class="tm-ac-interval-label">
                            <strong>Интервал между сообщениями</strong>
                            <small>Задайте примерное время между отправками</small>
                        </div>
                        <div class="tm-ac-interval-control">
                            <input type="number" id="tm-ac-interval" value="5" min="2" max="3600" aria-label="Интервал отправки в секундах">
                            <span class="tm-ac-interval-unit">секунд</span>
                            <span class="tm-ac-random-tag" tabindex="0" data-tooltip="Пауза между сообщениями каждый раз немного меняется. Медленный режим Twitch тоже учитывается. Это подсказка, а не переключатель.">Случайный интервал</span>
                        </div>
                    </div>
                    <div class="tm-ac-followers-status" id="tm-ac-followers-status" role="status" hidden>
                        <span class="tm-ac-followers-icon">!</span>
                        <span class="tm-ac-followers-copy"><strong id="tm-ac-followers-title">Чат только для фолловеров</strong><small id="tm-ac-followers-detail">Чтобы отправлять сообщения, подпишитесь на канал.</small><small id="tm-ac-followers-source" hidden></small></span>
                    </div>
                    <div class="tm-ac-run-status" id="tm-ac-run-status">
                        <span class="tm-ac-run-indicator"></span>
                        <div class="tm-ac-run-status-copy">
                            <span class="tm-ac-run-state" id="tm-ac-run-state">Не запущено</span>
                            <span class="tm-ac-run-detail" id="tm-ac-run-detail">Нажмите «Старт» в заголовке, чтобы начать отправку</span>
                        </div>
                        <strong class="tm-ac-run-value" id="tm-ac-run-value">—</strong>
                    </div>
                    <div class="tm-ac-run-note">Запуск и остановка доступны по кнопкам «Старт» и «Стоп» в заголовке панели.</div>
                </div>

                <div class="tm-ac-tab-content" id="tm-tab-history">
                    <div class="tm-ac-hist-filter-wrapper" id="tm-ac-history-filter-wrapper">
                        <div class="tm-ac-hist-filter-header" id="tm-ac-history-filter-header">
                            <span id="tm-ac-history-filter-text">Все стримеры</span>
                            <span>▼</span>
                        </div>
                        <div class="tm-ac-hist-filter-list" id="tm-ac-history-filter-list"></div>
                    </div>
                    <div id="tm-ac-history-list"></div>
                </div>

                <div class="tm-ac-tab-content" id="tm-tab-settings">
                    <div class="tm-ac-section-title">Чат</div>
                    <label class="tm-ac-check">
                        <input type="checkbox" id="tm-ac-live-preview" ${settings.livePreview ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Live-превью</span><small>Показывает, как сообщение будет выглядеть в чате, пока вы его набираете.</small></span>
                    </label>
                    <label class="tm-ac-check">
                        <input type="checkbox" id="tm-ac-antispam" ${settings.antiSpamRandomizer ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Невидимые символы (Анти-спам)</span><small>Добавляет два невидимых символа в конец сообщения, чтобы одинаковые тексты отличались для фильтров повторов.</small></span>
                    </label>

                    <div class="tm-ac-section-title">Описание (баннеры)</div>
                    <label class="tm-ac-check">
                        <input type="checkbox" id="tm-ac-spoiler-enabled" ${settings.spoilerEnabled ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Размывать баннеры</span><small>Скрывает изображения баннеров под размытием до наведения курсора.</small></span>
                    </label>
                    <label class="tm-ac-check" id="tm-ac-spoiler-never-row">
                        <input type="checkbox" id="tm-ac-spoiler-never" ${settings.spoilerNeverReveal ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Не показывать даже при наведении</span><small>Оставляет баннеры размытыми постоянно, пока включена защита.</small></span>
                    </label>

                    <div class="tm-ac-section-title">Экспорт / Импорт</div>
                    <div style="display:flex; gap:8px;">
                        <button id="tm-export-btn" class="tm-ac-hist-btn" style="flex:1; padding:8px;">💾 Скачать</button>
                        <button id="tm-import-btn" class="tm-ac-hist-btn" style="flex:1; padding:8px;">📂 Загрузить</button>
                        <input type="file" id="tm-import-file" accept=".json" style="display:none;">
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        const editModal = document.createElement('div');
        editModal.id = 'tm-edit-modal';
        editModal.innerHTML = `
            <div class="tm-edit-content">
                <div class="tm-edit-header">
                    <div class="tm-edit-heading"><h3>Редактирование пасты</h3><span class="tm-edit-subtitle">Добавьте несколько текстов — при отправке скрипт выберет один случайно.</span></div>
                    <button class="tm-edit-btn cancel" id="tm-edit-close-btn" style="padding:4px 8px;">✕</button>
                </div>
                <div class="tm-edit-body" id="tm-edit-variants-container"></div>
                <div class="tm-edit-actions">
                    <button class="tm-edit-btn add" id="tm-edit-add-btn">+ Добавить вариант</button>
                    <div style="display:flex; gap:10px;">
                        <button class="tm-edit-btn cancel" id="tm-edit-cancel-btn">Отмена</button>
                        <button class="tm-edit-btn save" id="tm-edit-save-btn">Сохранить</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(editModal);
        const emoteModal = document.createElement('div');
        emoteModal.id = 'tm-emote-picker-modal';
        emoteModal.innerHTML = `
            <div class="tm-ep-content">
                <div class="tm-ep-header">
                    <input type="text" id="tm-ep-search" placeholder="Поиск смайлов...">
                    <button class="tm-ep-close" id="tm-ep-close-btn">✕</button>
                </div>
                <div class="tm-ep-list" id="tm-ep-list"></div>
            </div>
        `;
        document.body.appendChild(emoteModal);
        function closePanel() {
            panel.classList.remove('open');
            toggleSidebarBtn.classList.remove('open');
            toggleSidebarBtn.innerHTML = '◀';
        }
        function isElementVisible(element) {
            if (!element || !element.isConnected) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.visibility !== 'collapse' &&
                style.opacity !== '0' &&
                element.getClientRects().length > 0;
        }
        function isChannelHomeNavigationVisible() {
            const carousel = document.querySelector('[data-a-target="channel-home-carousel"]');
            if (carousel && carousel.isConnected) return true;
            const channelLabels = /^(главная|описание|клипы|видео|расписание|home|about|clips|videos|schedule)(?:\s|$)/i; const channelPaths = new Set(['about', 'clips', 'videos', 'schedule']);
            for (const tablist of document.querySelectorAll('[role="tablist"]')) {
                if (!isElementVisible(tablist)) continue;
                const tabs = tablist.querySelectorAll('[role="tab"], a[href]');
                for (const tab of tabs) {
                    const label = (tab.innerText || tab.textContent || tab.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                    if (channelLabels.test(label)) return true;
                }
            }
            const channelLinks = Array.from(document.querySelectorAll('a[href]')).filter(link => {
                if (!isElementVisible(link)) return false;
                let target;
                try {
                    target = new URL(link.href, window.location.origin);
                } catch {
                    return false;
                }
                const parts = target.pathname.split('/').filter(Boolean);
                if (parts.length !== 2 || !channelPaths.has(parts[1].toLowerCase())) return false;
                const label = (link.innerText || link.textContent || link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                return channelLabels.test(label);
            });
            if (channelLinks.some(link => link.closest('[data-a-target*="channel-header"]'))) return true;
            const groups = new Map();
            for (const link of channelLinks) {
                const container = link.closest('nav, [role="tablist"], header, [data-a-target*="channel-header"]') || link.parentElement;
                if (container) groups.set(container, (groups.get(container) || 0) + 1);
            }
            return Array.from(groups.values()).some(count => count >= 2);
        }
        let isChatCurrentlyVisible = false; let observedChatRoom = null;
        const chatRoomResizeObserver = new ResizeObserver(() => {
            if (refreshAutoChatVisibility) refreshAutoChatVisibility();
        });
        function updateChatVisibility() {
            const chatInput = document.querySelector('div[data-a-target="chat-input"]'); const chatRoom = document.querySelector('section[data-test-selector="chat-room-component-layout"]') || document.querySelector('.chat-room');
            if (chatRoom !== observedChatRoom) {
                if (observedChatRoom) chatRoomResizeObserver.unobserve(observedChatRoom);
                observedChatRoom = chatRoom;
                if (observedChatRoom) chatRoomResizeObserver.observe(observedChatRoom);
            }
            let isChatValid = false;
            if (!isChannelHomeNavigationVisible() && chatRoom && chatInput) {
                const roomRect = chatRoom.getBoundingClientRect(); const inputRect = chatInput.getBoundingClientRect(); const roomStyle = window.getComputedStyle(chatRoom); const chatText = (chatRoom.innerText || '').toLowerCase();
                const isOffline =
                    !!document.querySelector('[data-a-target="player-overlay-content-gate"]') ||
                    !!document.querySelector('.offline-indicator') ||
                    !!document.querySelector('[data-a-target="channel-header-offline-indicator"]') ||
                    chatText.includes('чат недоступен') ||
                    chatText.includes('chat is disabled') ||
                    inputRect.width === 0 ||
                    inputRect.height === 0;
                if (roomRect.width > 100 && roomRect.height > 100 && roomRect.left < window.innerWidth &&
                    roomStyle.display !== 'none' && roomStyle.visibility !== 'hidden' && roomStyle.opacity !== '0' &&
                    !chatRoom.classList.contains('collapsed') && !isOffline) {
                    isChatValid = true;
                }
            }
            if (isChatValid) {
                const rightOffset = window.innerWidth - chatRoom.getBoundingClientRect().left;
                toggleSidebarBtn.style.right = rightOffset + 'px';
                panel.style.right = rightOffset + 'px';
                toggleSidebarBtn.classList.add('visible');
                isChatCurrentlyVisible = true;
            } else {
                isChatCurrentlyVisible = false;
                toggleSidebarBtn.classList.remove('visible');
            }
        }
        refreshAutoChatVisibility = updateChatVisibility;
        window.addEventListener('resize', updateChatVisibility);
        updateChatVisibility();
        toggleSidebarBtn.addEventListener('click', (e) => {
            if (!e.isTrusted) return;
            e.preventDefault(); e.stopPropagation();
            if (!isChatCurrentlyVisible) return;
            if (panel.classList.contains('open')) {
                closePanel();
                return;
            }
            panel.classList.add('open');
            toggleSidebarBtn.classList.add('open');
            toggleSidebarBtn.innerHTML = '▶';
            if (refreshFollowersOnlyStatus) setTimeout(refreshFollowersOnlyStatus, 0);
        });
        panel.querySelector('#tm-autochat-toggle').addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });

        const tabs = panel.querySelectorAll('.tm-ac-tab'); const contents = panel.querySelectorAll('.tm-ac-tab-content');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                document.getElementById('tm-tab-' + target).classList.add('active');
                currentTab = target;
                if (target === 'send') {
                    updateLivePreview(msgEl.value, username);
                    removeHistoryPreview();
                } else {
                    removeLivePreview();
                    if (target === 'history') renderHistory();
                }
            });
        });
        const msgEl = panel.querySelector('#tm-ac-msg'); const intervalEl = panel.querySelector('#tm-ac-interval'); const startBtn = panel.querySelector('#tm-ac-start'); const stopBtn = panel.querySelector('#tm-ac-stop');
        const statusEl = panel.querySelector('#tm-ac-status'); const historyList = panel.querySelector('#tm-ac-history-list'); const charCount = panel.querySelector('#tm-ac-char-count'); const livePreviewCheck = panel.querySelector('#tm-ac-live-preview');
        const runStatusCard = panel.querySelector('#tm-ac-run-status'); const runStateEl = panel.querySelector('#tm-ac-run-state'); const runDetailEl = panel.querySelector('#tm-ac-run-detail'); const runValueEl = panel.querySelector('#tm-ac-run-value');
        const antispamCheck = panel.querySelector('#tm-ac-antispam'); const spoilerEnabledCheck = panel.querySelector('#tm-ac-spoiler-enabled'); const spoilerNeverCheck = panel.querySelector('#tm-ac-spoiler-never'); const spoilerNeverRow = panel.querySelector('#tm-ac-spoiler-never-row');
        const slowmodePill = panel.querySelector('#tm-ac-slowmode-pill'); const slowmodeText = panel.querySelector('#tm-ac-slowmode-text'); const followersOnlyStatusEl = panel.querySelector('#tm-ac-followers-status'); const followersOnlyTitleEl = panel.querySelector('#tm-ac-followers-title'); const followersOnlyDetailEl = panel.querySelector('#tm-ac-followers-detail'); const followersOnlySourceEl = panel.querySelector('#tm-ac-followers-source'); const filterWrapper = panel.querySelector('#tm-ac-history-filter-wrapper'); const filterHeader = panel.querySelector('#tm-ac-history-filter-header');
        const filterText = panel.querySelector('#tm-ac-history-filter-text'); const filterList = panel.querySelector('#tm-ac-history-filter-list'); const emoteSearch = emoteModal.querySelector('#tm-ep-search'); const emoteList = emoteModal.querySelector('#tm-ep-list');
        function openEmotePicker(targetTextarea) {
            currentEmoteTarget = targetTextarea;
            emoteModal.classList.add('open');
            emoteSearch.value = '';
            renderEmotePickerList('');
            emoteSearch.focus();
        }
        function renderEmotePickerList(query) {
            emoteList.innerHTML = '';
            const emotes = Array.from(emoteMap.entries()).filter(([name]) => channelEmoteNames.has(name)); const filtered = emotes.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
            if (filtered.length === 0) {
                emoteList.innerHTML = '<div style="color:#adadb8; font-size:13px; padding:20px; width:100%; text-align:center;">Смайлы не найдены</div>';
            } else {
                filtered.forEach(([name, data]) => {
                    const img = document.createElement('img');
                    if (data.srcset) img.srcset = data.srcset;
                    if (data.src) img.src = data.src;
                    img.title = name;
                    img.addEventListener('click', () => {
                        if (currentEmoteTarget) {
                            const start = currentEmoteTarget.selectionStart; const end = currentEmoteTarget.selectionEnd; const text = currentEmoteTarget.value;
                            currentEmoteTarget.value = text.substring(0, start) + " " + name + " " + text.substring(end);
                            currentEmoteTarget.selectionStart = currentEmoteTarget.selectionEnd = start + name.length + 2;
                            currentEmoteTarget.dispatchEvent(new Event("tm-emote-inserted", { bubbles: true }));
                            currentEmoteTarget.focus();
                        }
                    });
                    emoteList.appendChild(img);
                });
            }
        }
        emoteSearch.addEventListener('input', (e) => renderEmotePickerList(e.target.value));
        emoteModal.querySelector('#tm-ep-close-btn').addEventListener('click', () => emoteModal.classList.remove('open'));
        emoteModal.addEventListener('click', (e) => { if (e.target === emoteModal) emoteModal.classList.remove('open'); });
        panel.querySelector('#tm-ac-emotes-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openEmotePicker(msgEl);
        });
        if (data.msg) msgEl.value = data.msg.slice(0, MAX_CHARS);
        if (data.interval) intervalEl.value = data.interval;
        filterHeader.addEventListener('click', (e) => { e.stopPropagation(); filterList.classList.toggle('open'); });
        document.addEventListener('click', (e) => { if (!filterWrapper.contains(e.target)) filterList.classList.remove('open'); });
        function updateCharCount() {
            const len = msgEl.value.length;
            charCount.textContent = `${len} / ${MAX_CHARS}`;
            charCount.classList.toggle('over', len >= MAX_CHARS);
        }
        updateCharCount();
        msgEl.addEventListener("tm-emote-inserted", updateCharCount);
        msgEl.addEventListener('input', () => {
            if (msgEl.value.length > MAX_CHARS) msgEl.value = msgEl.value.slice(0, MAX_CHARS);
            updateCharCount();
            saveBasic();
            updateLivePreview(msgEl.value, username);
            activeHistoryIdx = -1;
        });
        function saveBasic() {
            const d = loadData();
            d.msg = msgEl.value;
            d.interval = intervalEl.value;
            saveData(d);
        }
        intervalEl.addEventListener('change', saveBasic);
        function updateSpoilerLock() {
            const enabled = spoilerEnabledCheck.checked;
            spoilerNeverCheck.disabled = !enabled;
            spoilerNeverRow.classList.toggle('locked', !enabled);
        }
        function saveSettings() {
            const d = loadData();
            d.livePreview = livePreviewCheck.checked;
            d.antiSpamRandomizer = antispamCheck.checked;
            d.spoilerEnabled = spoilerEnabledCheck.checked;
            d.spoilerNeverReveal = spoilerNeverCheck.checked;
            saveData(d);
            applySpoilerSettings();
            updateSpoilerLock();
            updateLivePreview(msgEl.value, username);
        }
        livePreviewCheck.addEventListener('change', saveSettings);
        antispamCheck.addEventListener('change', saveSettings);
        spoilerEnabledCheck.addEventListener('change', saveSettings);
        spoilerNeverCheck.addEventListener('change', saveSettings);
        updateSpoilerLock();
        panel.querySelector('#tm-export-btn').addEventListener('click', () => {
            const d = loadData(); const blob = new Blob([JSON.stringify(d.history || [], null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
            a.href = url;
            a.download = `autochat_history_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
        const fileInput = panel.querySelector('#tm-import-file');
        panel.querySelector('#tm-import-btn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const imported = JSON.parse(ev.target.result);
                    if (Array.isArray(imported)) {
                        const d = loadData(); const currentHist = getHistory(); const newHist = [...imported, ...currentHist.filter(h => !imported.some(i => i.variants[0] === h.variants[0]))];
                        d.history = newHist;
                        saveData(d);
                        renderHistory();
                        alert('Успешно импортировано!');
                    }
                } catch { alert('Ошибка чтения файла'); }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });
        function getHistory() {
            const d = loadData(); let hist = d.history || []; let changed = false;
            hist.forEach(h => {
                if (!h.variants) {
                    h.variants = [h.text || ''];
                    delete h.text;
                    changed = true;
                }
                if (!h.pinnedIn) {
                    h.pinnedIn = [];
                    changed = true;
                }
            });
            if (changed) { d.history = hist; saveData(d); }
            return hist;
        }
        function addToHistory(variants) {
            if (!variants || variants.length === 0 || !variants[0].trim()) return;
            let hist = getHistory(); const ch = getChannelInfo(); const mainText = variants[0]; const existingIdx = hist.findIndex(h => h.variants[0] === mainText && (!h.channel || h.channel.name === ch.name));
            if (existingIdx !== -1) hist.splice(existingIdx, 1);
            hist.unshift({ variants, pinnedIn: [], chars: mainText.length, channel: ch });
            const d = loadData();
            d.history = hist;
            saveData(d);
            renderHistory();
        }
        function deleteHistoryItem(idx) {
            const hist = getHistory();
            if (!hist[idx]) return;
            hist.splice(idx, 1);
            if (activeHistoryIdx === idx) activeHistoryIdx = -1;
            else if (activeHistoryIdx > idx) activeHistoryIdx--;
            const d = loadData();
            d.history = hist;
            saveData(d);
            renderHistory();
        }
        function togglePin(idx) {
            const hist = getHistory();
            if (!hist[idx]) return;
            if (!hist[idx].pinnedIn) hist[idx].pinnedIn = [];
            const i = hist[idx].pinnedIn.indexOf(currentFilter);
            if (i > -1) hist[idx].pinnedIn.splice(i, 1);
            else hist[idx].pinnedIn.push(currentFilter);
            const d = loadData();
            d.history = hist;
            saveData(d);
            renderHistory();
        }
        function openEditModal(idx) {
            const entry = getHistory()[idx]; const variantsContainer = editModal.querySelector('#tm-edit-variants-container');
            variantsContainer.innerHTML = '';
            const updateVariantLabels = () => {
                const rows = Array.from(variantsContainer.querySelectorAll('.tm-variant-row'));
                rows.forEach((row, index) => {
                    const ta = row.querySelector('textarea');
                    const count = row.querySelector('.tm-variant-count');
                    const removeBtn = row.querySelector('.remove-btn');
                    row.querySelector(".tm-variant-title").textContent = `Вариант ${index + 1}`;
                    count.textContent = `${ta.value.length} / ${MAX_CHARS}`;
                    count.classList.toggle('over', ta.value.length >= MAX_CHARS);
                    removeBtn.disabled = rows.length <= 1;
                    removeBtn.title = rows.length <= 1 ? "Нельзя удалить единственный вариант" : "Удалить этот вариант";
                });
            };
            const addVariantInput = (val = "") => {
                const row = document.createElement('div');
                row.className = 'tm-variant-row';
                row.innerHTML = `
                    <div class="tm-variant-top">
                        <div class="tm-variant-heading">
                            <strong class="tm-variant-title">Вариант</strong>
                            <span class="tm-variant-count">0 / ${MAX_CHARS}</span>
                        </div>
                        <div class="tm-variant-tools">
                            <button class="tm-edit-btn add-emote-btn" type="button" title="Вставить смайл">😀 Смайл</button>
                            <button class="tm-edit-btn cancel remove-btn" type="button" title="Удалить вариант">✕ Удалить</button>
                        </div>
                    </div>
                    <textarea class="tm-edit-textarea" maxlength="${MAX_CHARS}">${escapeHtml(val)}</textarea>
                `;
                row.querySelector('.remove-btn').addEventListener('click', () => {
                    if (variantsContainer.children.length > 1) {
                        row.remove();
                        updateVariantLabels();
                    }
                });
                const ta = row.querySelector('textarea');
                ta.addEventListener('input', updateVariantLabels);
                ta.addEventListener('tm-emote-inserted', updateVariantLabels);
                row.querySelector('.add-emote-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEmotePicker(ta);
                });
                variantsContainer.appendChild(row);
                updateVariantLabels();
            };
            const currentVariants = entry.variants || [''];
            currentVariants.forEach(v => addVariantInput(v));
            editModal.classList.add('open');
            const closeModal = () => editModal.classList.remove('open'); const addBtn = editModal.querySelector('#tm-edit-add-btn'); const saveBtn = editModal.querySelector('#tm-edit-save-btn'); const cancelBtn = editModal.querySelector('#tm-edit-cancel-btn');
            const closeBtn = editModal.querySelector('#tm-edit-close-btn'); const newAddBtn = addBtn.cloneNode(true);
            addBtn.replaceWith(newAddBtn);
            newAddBtn.addEventListener('click', () => addVariantInput(''));
            const handleSave = () => {
                const textareas = variantsContainer.querySelectorAll('textarea'); const newVariants = [];
                textareas.forEach(t => {
                    const val = t.value.trim();
                    if (val) newVariants.push(val);
                });
                if (newVariants.length > 0) {
                    const hist = getHistory();
                    hist[idx].variants = newVariants;
                    hist[idx].chars = newVariants[0].length;
                    const d = loadData();
                    d.history = hist;
                    saveData(d);
                }
                closeModal();
                renderHistory();
            };
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.replaceWith(newSaveBtn);
            newSaveBtn.addEventListener('click', handleSave);
            const newCancelBtn = cancelBtn.cloneNode(true);
            cancelBtn.replaceWith(newCancelBtn);
            newCancelBtn.addEventListener('click', closeModal);
            const newCloseBtn = closeBtn.cloneNode(true);
            closeBtn.replaceWith(newCloseBtn);
            newCloseBtn.addEventListener('click', closeModal);
        }
        function renderHistory() {
            const hist = getHistory(); const indexedHist = hist.map((h, i) => ({ ...h, originalIdx: i }));
            indexedHist.sort((a, b) => {
                const aPin = (a.pinnedIn || []).includes(currentFilter); const bPin = (b.pinnedIn || []).includes(currentFilter);
                return (bPin ? 1 : 0) - (aPin ? 1 : 0);
            });
            const uniqueChannels = new Map();
            hist.forEach(h => {
                if (h.channel && h.channel.name) {
                    if (h.channel.name === 'all') uniqueChannels.set('all', { name: 'all', displayName: 'Везде', avatar: '' });
                    else if (h.channel.name !== 'unknown') uniqueChannels.set(h.channel.name, h.channel);
                }
            });
            let optionsHtml = `<div class="tm-ac-hist-filter-item ${currentFilter === 'all' ? 'selected' : ''}" data-val="all">${renderAvatar('', 20)} Все стримеры</div>`; const hasUnknown = hist.some(h => !h.channel || !h.channel.name || h.channel.name === 'unknown');
            if (hasUnknown) optionsHtml += `<div class="tm-ac-hist-filter-item ${currentFilter === 'unknown' ? 'selected' : ''}" data-val="unknown">${renderAvatar('', 20)} Неизвестные</div>`;
            const hasAll = hist.some(h => h.channel && h.channel.name === 'all');
            if (hasAll) optionsHtml += `<div class="tm-ac-hist-filter-item ${currentFilter === 'all-pastes' ? 'selected' : ''}" data-val="all-pastes">${renderAvatar('', 20)} Везде</div>`;
            Array.from(uniqueChannels.values()).sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name)).forEach(ch => {
                if (ch.name === 'all') return;
                optionsHtml += `<div class="tm-ac-hist-filter-item ${currentFilter === ch.name ? 'selected' : ''}" data-val="${escapeHtml(ch.name)}">${renderAvatar(ch.name, 20)} ${escapeHtml(ch.displayName || ch.name)}</div>`;
            });
            filterList.innerHTML = optionsHtml;
            if (currentFilter === 'all') filterText.textContent = 'Все стримеры';
            else if (currentFilter === 'unknown') filterText.textContent = 'Неизвестные';
            else if (currentFilter === 'all-pastes') filterText.textContent = 'Везде';
            else {
                const ch = uniqueChannels.get(currentFilter);
                filterText.textContent = ch ? (ch.displayName || ch.name) : 'Все стримеры';
            }
            filterList.querySelectorAll('.tm-ac-hist-filter-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentFilter = item.dataset.val;
                    filterList.classList.remove('open');
                    renderHistory();
                });
            });
            let filteredHist = indexedHist;
            if (currentFilter === 'unknown') filteredHist = indexedHist.filter(h => !h.channel || !h.channel.name || h.channel.name === 'unknown');
            else if (currentFilter === 'all-pastes') filteredHist = indexedHist.filter(h => h.channel && h.channel.name === 'all');
            else if (currentFilter !== 'all') filteredHist = indexedHist.filter(h => h.channel && h.channel.name === currentFilter);
            if (filteredHist.length === 0) {
                historyList.innerHTML = `<div class="tm-ac-hist-empty">Нет паст для этого выбора</div>`;
                return;
            }
            historyList.innerHTML = filteredHist.map((h) => {
                const originalIdx = h.originalIdx; const ch = h.channel || { name: "unknown", displayName: "Unknown" }; const isUnknown = (!ch.name || ch.name === "unknown"); const isAll = ch.name === "all";
                const displayName = isUnknown ? "Unknown (нажмите чтобы изменить)" : (isAll ? "Везде" : (ch.displayName || ch.name)); const isPinned = (h.pinnedIn || []).includes(currentFilter); const mainText = h.variants[0] || "";
                const variantCount = h.variants.length;
                const variantLabel = variantCount % 10 === 1 && variantCount % 100 !== 11 ? "вариант" : variantCount % 10 >= 2 && variantCount % 10 <= 4 && (variantCount % 100 < 12 || variantCount % 100 > 14) ? "варианта" : "вариантов";
                return `
                    <div class="tm-ac-hist-item ${isPinned ? "pinned" : ""}" data-idx="${originalIdx}" draggable="true">
                        <div class="tm-ac-hist-topline">
                            <div class="tm-ac-hist-channel">
                                ${renderAvatar(ch.name, 16)}
                                <span>${escapeHtml(displayName)}</span>
                            </div>
                            ${variantCount > 1 ? `<span class="tm-ac-variant-badge">${variantCount} ${variantLabel}</span>` : ""}
                        </div>
                        <div class="tm-ac-hist-text">${renderEmotes(mainText)}</div>
                        <div class="tm-ac-hist-meta">
                            <span>${h.chars || mainText.length} симв.</span>
                            <div class="tm-ac-hist-actions">
                                <div class="tm-ac-hist-action-main">
                                    <button class="tm-ac-hist-btn use" data-tooltip="Загрузить пасту во вкладку «Отправка»" aria-label="Выбрать пасту">Выбрать</button>
                                    <button class="tm-ac-hist-btn send" data-tooltip="Удерживайте 1 секунду, чтобы отправить" aria-label="Отправить пасту">📤</button>
                                </div>
                                <div class="tm-ac-hist-action-tools">
                                    <button class="tm-ac-hist-btn preview" data-tooltip="Показать предпросмотр" aria-label="Предпросмотр">👁</button>
                                    <button class="tm-ac-hist-btn edit" data-tooltip="Редактировать текст и варианты" aria-label="Редактировать">✏️</button>
                                    <button class="tm-ac-hist-btn pin ${isPinned ? "active" : ""}" data-tooltip="${isPinned ? "Открепить от этого фильтра" : "Закрепить в этом фильтре"}" aria-label="${isPinned ? "Открепить" : "Закрепить"}">${isPinned ? "📌" : "📍"}</button>
                                    <button class="tm-ac-hist-btn delete" data-tooltip="Удерживайте 1 секунду, чтобы удалить" aria-label="Удалить пасту">🗑</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            let draggedItem = null; let draggedIdx = -1;
            historyList.querySelectorAll('.tm-ac-hist-item').forEach(item => {
                item.addEventListener('dragstart', (e) => {
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                        e.preventDefault();
                        return;
                    }
                    draggedItem = item;
                    draggedIdx = parseInt(item.dataset.idx);
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });
                item.addEventListener('dragend', () => {
                    if (draggedItem) draggedItem.classList.remove('dragging');
                    historyList.querySelectorAll('.tm-ac-hist-item').forEach(i => i.classList.remove('drag-over'));
                    draggedItem = null;
                });
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (!draggedItem || draggedItem === item) return;
                    item.classList.add('drag-over');
                });
                item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    item.classList.remove('drag-over');
                    if (draggedItem && draggedItem !== item) {
                        const targetIdx = parseInt(item.dataset.idx); const hist = getHistory();
                        const [moved] = hist.splice(draggedIdx, 1);
                        hist.splice(targetIdx, 0, moved);
                        const d = loadData();
                        d.history = hist;
                        saveData(d);
                        if (activeHistoryIdx === draggedIdx) activeHistoryIdx = targetIdx;
                        else if (activeHistoryIdx > draggedIdx && activeHistoryIdx <= targetIdx) activeHistoryIdx--;
                        else if (activeHistoryIdx < draggedIdx && activeHistoryIdx >= targetIdx) activeHistoryIdx++;
                        renderHistory();
                    }
                });
            });
            historyList.querySelectorAll('.tm-ac-hist-item').forEach(item => {
                const idx = +item.dataset.idx; const entry = getHistory()[idx]; const previewBtn = item.querySelector('.preview'); const channelEl = item.querySelector('.tm-ac-hist-channel');
                if (channelEl) {
                    channelEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const oldHtml = channelEl.innerHTML;
                        channelEl.innerHTML = `
                            <input type="text" class="tm-ac-hist-channel-input" placeholder="Введите ник..." autofocus>
                            <div class="tm-ac-autocomplete-list" style="display:none;"></div>
                        `;
                        const input = channelEl.querySelector('input'); const list = channelEl.querySelector('.tm-ac-autocomplete-list'); let saved = false;
                        const save = (forcedValue) => {
                            if (saved) return;
                            saved = true;
                            let val = (forcedValue || input.value).trim().toLowerCase();
                            if (val) {
                                const histNow = getHistory();
                                if (val === 'all' || val === 'везде') histNow[idx].channel = { name: 'all', displayName: 'Везде', avatar: '' };
                                else histNow[idx].channel = { name: val, displayName: val, avatar: getAvatarUrl(val) };
                                const d = loadData();
                                d.history = histNow;
                                saveData(d);
                                renderHistory();
                            } else {
                                channelEl.innerHTML = oldHtml;
                            }
                        };
                        input.addEventListener('input', () => {
                            const q = input.value.trim().toLowerCase(); let html = `<div class="tm-ac-autocomplete-item" data-name="all">${renderAvatar('', 16)} <span>Везде</span></div>`;
                            if (q) {
                                const matches = Array.from(uniqueChannels.values()).filter(c => c.name.includes(q) || (c.displayName && c.displayName.toLowerCase().includes(q)));
                                if (matches.length > 0) {
                                    html += matches.map(c => `
                                        <div class="tm-ac-autocomplete-item" data-name="${escapeHtml(c.name)}">
                                            ${renderAvatar(c.name, 16)}
                                            <span>${escapeHtml(c.displayName || c.name)}</span>
                                        </div>
                                    `).join('');
                                }
                            }
                            list.innerHTML = html;
                            list.style.display = 'block';
                            list.querySelectorAll('.tm-ac-autocomplete-item').forEach(mitem => {
                                mitem.addEventListener('mousedown', (ev) => {
                                    ev.preventDefault();
                                    input.value = mitem.dataset.name;
                                    save(mitem.dataset.name);
                                });
                            });
                        });
                        input.addEventListener('keydown', (ev) => {
                            if (ev.key === 'Enter') { ev.preventDefault(); save(); }
                            if (ev.key === 'Escape') { saved = true; channelEl.innerHTML = oldHtml; }
                        });
                        input.addEventListener('blur', () => save());
                        input.focus();
                        input.dispatchEvent(new Event('input'));
                    });
                }
                item.querySelector('.use').addEventListener('click', (e) => {
                    e.stopPropagation();
                    activeHistoryIdx = idx;
                    msgEl.value = (entry?.variants[0] || '').slice(0, MAX_CHARS);
                    updateCharCount();
                    saveBasic();
                    tabs.forEach(t => t.classList.remove('active'));
                    contents.forEach(c => c.classList.remove('active'));
                    panel.querySelector('[data-tab="send"]').classList.add('active');
                    document.getElementById('tm-tab-send').classList.add('active');
                    currentTab = 'send';
                    updateLivePreview(msgEl.value, username);
                    removeHistoryPreview();
                });
                item.querySelector('.pin').addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePin(idx);
                });
                item.querySelector('.edit').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditModal(idx);
                });
                const sendBtn = item.querySelector('.send'); let holdTimer = null, holdFrame = null, holdStart = 0, suppressClick = false;
                const resetHold = () => {
                    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                    if (holdFrame) { cancelAnimationFrame(holdFrame); holdFrame = null; }
                    sendBtn.style.background = '';
                };
                const doSendOnce = async () => {
                    resetHold();
                    if (sendBtn.disabled) return;
                    sendBtn.disabled = true;
                    suppressClick = true;
                    try {
                        const restriction = getChatRestriction();
                        if (restriction) {
                            setStatus(`⛔ ${restriction.message.replace(/\n/g, '<br>')}`, 'blocked');
                            setTimeout(() => { if (!isRunning) setStatus('Стоп'); }, 3000);
                            return;
                        }
                        const randVariant = entry?.variants[Math.floor(Math.random() * entry.variants.length)] || '';
                        if (!randVariant.trim()) return;
                        const result = await sendChatMessage(randVariant);
                        if (result.ok) {
                            if (!isRunning) {
                                setStatus('✓ Отправлено', 'running');
                                setTimeout(() => { if (!isRunning) setStatus('Стоп'); }, 2000);
                            }
                        } else if (result.restriction) {
                            setStatus(`⛔ ${result.restriction.message.replace(/\n/g, '<br>')}`, 'blocked');
                            setTimeout(() => { if (!isRunning) setStatus('Стоп'); }, 3000);
                        }
                    } finally {
                        sendBtn.disabled = false;
                        setTimeout(() => { suppressClick = false; }, 50);
                    }
                };
                sendBtn.addEventListener('pointerdown', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (sendBtn.disabled) return;
                    holdStart = Date.now();
                    const update = () => {
                        const p = Math.min(1, (Date.now() - holdStart) / HOLD_SEND_MS);
                        sendBtn.style.background = `linear-gradient(90deg, #00a865 ${p * 100}%, #2f2f35 ${p * 100}%)`;
                        if (p < 1) holdFrame = requestAnimationFrame(update);
                    };
                    holdFrame = requestAnimationFrame(update);
                    holdTimer = setTimeout(doSendOnce, HOLD_SEND_MS);
                });
                sendBtn.addEventListener('pointerup', resetHold);
                sendBtn.addEventListener('pointercancel', resetHold);
                sendBtn.addEventListener('pointerleave', resetHold);
                sendBtn.addEventListener('click', (e) => { e.stopPropagation(); if (suppressClick) e.preventDefault(); });
                const deleteBtn = item.querySelector('.delete'); let delHoldTimer = null, delHoldFrame = null, delHoldStart = 0, delSuppressClick = false;
                const resetDelHold = () => {
                    if (delHoldTimer) { clearTimeout(delHoldTimer); delHoldTimer = null; }
                    if (delHoldFrame) { cancelAnimationFrame(delHoldFrame); delHoldFrame = null; }
                    deleteBtn.style.background = '';
                };
                const doDelete = () => {
                    resetDelHold();
                    delSuppressClick = true;
                    deleteHistoryItem(idx);
                    setTimeout(() => { delSuppressClick = false; }, 50);
                };
                deleteBtn.addEventListener('pointerdown', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    delHoldStart = Date.now();
                    const update = () => {
                        const p = Math.min(1, (Date.now() - delHoldStart) / HOLD_SEND_MS);
                        deleteBtn.style.background = `linear-gradient(90deg, #e91916 ${p * 100}%, #2f2f35 ${p * 100}%)`;
                        if (p < 1) delHoldFrame = requestAnimationFrame(update);
                    };
                    delHoldFrame = requestAnimationFrame(update);
                    delHoldTimer = setTimeout(doDelete, HOLD_SEND_MS);
                });
                deleteBtn.addEventListener('pointerup', resetDelHold);
                deleteBtn.addEventListener('pointercancel', resetDelHold);
                deleteBtn.addEventListener('pointerleave', resetDelHold);
                deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); if (delSuppressClick) e.preventDefault(); });
                previewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const randVariant = entry?.variants[Math.floor(Math.random() * entry.variants.length)] || ''; const opened = showHistoryPreview(randVariant, username);
                    document.querySelectorAll('.tm-ac-hist-btn.preview').forEach(b => b.classList.remove('active'));
                    if (opened) previewBtn.classList.add('active');
                });
                item.addEventListener('click', () => {
                    activeHistoryIdx = idx;
                    msgEl.value = (entry?.variants[0] || '').slice(0, MAX_CHARS);
                    updateCharCount();
                    saveBasic();
                });
            });
        }
        renderHistory();
        document.addEventListener('tm-emotes-updated', () => {
            if (currentTab === 'history') renderHistory();
        });
        function updateChannelState() {
            const currentCh = getChannelInfo().name;
            if (currentCh === lastKnownChannel) return;
            lastKnownChannel = currentCh;
            channelEmoteNames.forEach(name => emoteMap.delete(name));
            channelEmoteNames.clear();
            if (currentCh) fetchSevenTVEmotes(currentCh);
            const hist = getHistory();
            if (currentCh && hist.some(h => h.channel && h.channel.name === currentCh)) currentFilter = currentCh;
            else currentFilter = 'all';
            if (currentTab === 'history') renderHistory();
            if (currentTab === 'send') updateLivePreview(msgEl.value, username);
        }
        refreshChannelState = updateChannelState;
        updateChannelState();
        let timeoutId = null; let countdownInterval = null; let nextSendAt = 0; let lastRestrictionType = null;
        function setStatus(text, type = '') {
            statusEl.classList.remove('running', 'blocked', 'paused');
            if (type) statusEl.classList.add(type);
            const textEl = statusEl.querySelector('.tm-ac-status-text');
            if (textEl) {
                if (type === 'running') {
                    if (text.includes('отправка через') || text.includes('Работает')) {
                        const secMatch = text.match(/<b>(.*?)<\/b>/);
                        textEl.textContent = secMatch ? secMatch[1] : 'Работает';
                        statusEl.title = text.replace(/<[^>]*>/g, '');
                    } else {
                        textEl.textContent = text.replace(/<[^>]*>/g, '');
                        statusEl.title = text.replace(/<[^>]*>/g, '');
                    }
                } else if (type === 'blocked') {
                    textEl.textContent = 'Бан';
                    statusEl.title = text.replace(/\n/g, ' ').replace(/<[^>]*>/g, '');
                } else if (type === 'paused') {
                    textEl.textContent = 'Пауза';
                    statusEl.title = 'Ожидание отправки ручного сообщения';
                } else {
                    textEl.textContent = 'Стоп';
                    statusEl.title = 'Остановлено';
                }
            }
            const cleanText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            if (runStatusCard && runStateEl && runDetailEl && runValueEl) {
                runStatusCard.classList.toggle('running', type === 'running');
                runStatusCard.classList.toggle('blocked', type === 'blocked');
                runStatusCard.classList.toggle('paused', type === 'paused');
                if (type === 'running') {
                    const secMatch = text.match(/<b>(.*?)<\/b>/);
                    if (secMatch) {
                        runStateEl.textContent = "Автоотправка активна";
                        runDetailEl.textContent = "Следующее сообщение через";
                        runValueEl.textContent = secMatch[1];
                    } else if (cleanText.includes('Отправка')) {
                        runStateEl.textContent = "Отправка сообщения";
                        runDetailEl.textContent = "Сообщение передаётся в чат";
                        runValueEl.textContent = "…";
                    } else if (cleanText.includes('Отправлено')) {
                        runStateEl.textContent = "Сообщение отправлено";
                        runDetailEl.textContent = "Однократная отправка завершена";
                        runValueEl.textContent = "✓";
                    } else {
                        runStateEl.textContent = "Подготовка к отправке";
                        runDetailEl.textContent = "Запускается автоматический цикл";
                        runValueEl.textContent = "…";
                    }
                } else if (type === 'blocked') {
                    runStateEl.textContent = cleanText.includes("Нет текста") ? "Добавьте сообщение" : "Отправка недоступна";
                    runDetailEl.textContent = cleanText || "Проверьте сообщение и состояние чата";
                    runValueEl.textContent = "!";
                } else if (type === 'paused') {
                    runStateEl.textContent = "Пауза";
                    runDetailEl.textContent = "Автоматическая отправка приостановлена";
                    runValueEl.textContent = "Ⅱ";
                } else {
                    runStateEl.textContent = "Не запущено";
                    runDetailEl.textContent = "Нажмите «Старт» в заголовке, чтобы начать отправку";
                    runValueEl.textContent = "—";
                }
            }
        }
        function startCountdownDisplay() {
            stopCountdownDisplay();
            countdownInterval = setInterval(() => {
                if (!isRunning || isPausedByUser) return;
                const left = Math.max(0, nextSendAt - Date.now()); const sec = (left / 1000).toFixed(1);
                setStatus(`Работает • отправка через <b>${sec}с</b>`, 'running');
            }, 100);
        }
        function stopCountdownDisplay() {
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        }
        function updateChatStatusUI() {
            if (followersOnlyStatusEl) {
                const followersInfo = getFollowersOnlyInfo();
                followersOnlyStatusEl.hidden = !followersInfo;
                if (followersInfo) {
                    followersOnlySourceEl.hidden = true;
                    followersOnlyTitleEl.textContent = followersInfo.notFollowing ? 'Чат только для фолловеров' : 'Ограничение для фолловеров';
                    if (followersInfo.notFollowing) followersOnlyDetailEl.textContent = 'Чтобы отправлять сообщения, нажмите «Отслеживать» на канале.';
                    else if (followersInfo.remaining) followersOnlyDetailEl.textContent = `Ждать осталось: ${followersInfo.remaining}`;
                    else if (followersInfo.required) followersOnlyDetailEl.textContent = `Требуемый срок подписки: ${followersInfo.required}`;
                    else followersOnlyDetailEl.textContent = 'В чате действует ограничение для фолловеров.';
                    followersOnlySourceEl.textContent = followersInfo.text;
                    followersOnlySourceEl.hidden = true;
                }
            }
            const slowMode = getSlowModeInfo();
            if (slowMode > 0) {
                slowmodeText.textContent = slowMode;
                slowmodePill.style.display = 'flex';
            } else slowmodePill.style.display = 'none';
            const restriction = getChatRestriction();
            if (restriction) {
                if (lastRestrictionType !== restriction.type) {
                    playBeep();
                    if (isRunning) {
                        isRunning = false;
                        clearTimeout(timeoutId);
                        stopCountdownDisplay();
                        startBtn.style.display = '';
                        stopBtn.style.display = 'none';
                    }
                }
                lastRestrictionType = restriction.type;
                setStatus(`⛔ ${restriction.message.replace(/\n/g, '<br>')}`, 'blocked');
                startBtn.disabled = true;
            } else {
                if (lastRestrictionType) {
                    lastRestrictionType = null;
                    startBtn.disabled = false;
                    if (!isRunning) setStatus('Стоп');
                } else startBtn.disabled = false;
            }
        }
        refreshFollowersOnlyStatus = updateChatStatusUI;
        setInterval(updateChatStatusUI, 1500);
        updateChatStatusUI();
        function scheduleNext(baseSec) {
            if (!isRunning || isPausedByUser) return;
            const restriction = getChatRestriction();
            if (restriction) {
                setStatus(`⛔ ${restriction.message.replace(/\n/g, '<br>')}`, 'blocked');
                timeoutId = setTimeout(() => scheduleNext(baseSec), 5000);
                return;
            }
            const delay = getRandomDelay(baseSec);
            nextSendAt = Date.now() + delay;
            startCountdownDisplay();
            timeoutId = setTimeout(async () => {
                if (!isRunning || isPausedByUser) return;
                stopCountdownDisplay();
                setStatus('Отправка...', 'running');
                isAutoSending = true;
                let textToSend = msgEl.value.trim();
                if (activeHistoryIdx > -1) {
                    const entry = getHistory()[activeHistoryIdx];
                    if (entry && entry.variants && entry.variants.length > 0) {
                        textToSend = entry.variants[Math.floor(Math.random() * entry.variants.length)];
                    }
                }
                const result = await sendChatMessage(textToSend);
                setTimeout(() => { isAutoSending = false; }, 1000);
                if (!result.ok && result.restriction) {
                    setStatus(`⛔ ${result.restriction.message.replace(/\n/g, '<br>')}`, 'blocked');
                    timeoutId = setTimeout(() => scheduleNext(baseSec), 5000);
                } else scheduleNext(baseSec);
            }, delay);
        }
        startBtn.addEventListener('click', () => {
            const text = msgEl.value.trim(); const sec = Math.max(2, parseInt(intervalEl.value, 10) || 5);
            if (!text) { setStatus('Нет текста', 'blocked'); setTimeout(() => { if(!isRunning) setStatus('Стоп'); }, 2000); return; }
            if (getChatRestriction()) { setStatus(`⛔ ${getChatRestriction().message.replace(/\n/g, '<br>')}`, 'blocked'); return; }
            if (isRunning) return;
            isRunning = true;
            isPausedByUser = false;
            startBtn.style.display = 'none';
            stopBtn.style.display = '';
            setStatus('Ожидание...', 'running');
            removeLivePreview();
            if (activeHistoryIdx === -1) {
                addToHistory([text]);
            }
            saveBasic();
            scheduleNext(sec);
        });
        stopBtn.addEventListener('click', () => {
            isRunning = false;
            isPausedByUser = false;
            clearTimeout(timeoutId);
            timeoutId = null;
            stopCountdownDisplay();
            startBtn.style.display = '';
            stopBtn.style.display = 'none';
            updateChatStatusUI();
            if (!getChatRestriction()) setStatus('Стоп');
            if (currentTab === 'send') updateLivePreview(msgEl.value, username);
        });
        function attachChatListeners() {
            const chatInput = findChatInput();
            if (!chatInput || chatInput.dataset.tmListenersAttached) return;
            chatInput.dataset.tmListenersAttached = 'true';
            const checkInputState = () => {
                if (isAutoSending) return;
                const currentText = (chatInput.innerText || '').trim();
                if (currentText.length > 0) {
                    if (isRunning && !isPausedByUser) {
                        isPausedByUser = true;
                        clearTimeout(timeoutId);
                        stopCountdownDisplay();
                        setStatus('Пауза (ручной ввод)', 'paused');
                    }
                } else if (currentText.length === 0) {
                    if (isPausedByUser) {
                        isPausedByUser = false;
                        if (isRunning) {
                            setTimeout(() => {
                                if (isRunning && !isPausedByUser) {
                                    const sec = Math.max(2, parseInt(intervalEl.value, 10) || 5);
                                    scheduleNext(sec);
                                }
                            }, 1000);
                        } else setStatus('Стоп');
                    }
                }
            };
            chatInput.addEventListener('input', checkInputState);
            chatInput.addEventListener('focusin', () => setTimeout(() => { if (refreshFollowersOnlyStatus) refreshFollowersOnlyStatus(); }, 120));
            chatInput.addEventListener('keydown', (e) => {
                if (isAutoSending) return;
                if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') setTimeout(checkInputState, 10);
                else if (e.key === 'Enter' && !e.shiftKey) setTimeout(checkInputState, 200);
            });
            const sendBtnChat = findSendButton();
            if (sendBtnChat && !sendBtnChat.dataset.tmListenersAttached) {
                sendBtnChat.dataset.tmListenersAttached = 'true';
                sendBtnChat.addEventListener('click', () => { if (!isAutoSending) setTimeout(checkInputState, 200); });
            }
        }
        refreshChatListeners = attachChatListeners;
        attachChatListeners();
    }
    let initStarted = false;
    function initScript() {
        if (initStarted || !document.body) return;
        initStarted = true;
        injectStyle();
        applySpoilerSettings();
        setupSpoilers();
        createAutoChatUI();
        let updateScheduled = false; let pendingPageRecords = [];
        const isInternalNode = node => {
            if (!node || node.nodeType !== 1) return false;
            return node.matches('#tm-autochat-toggle-btn, #tm-autochat-panel, #tm-edit-modal, #tm-emote-picker-modal, #tm-modal-overlay, #tm-preview-container') ||
                !!node.closest('#tm-autochat-toggle-btn, #tm-autochat-panel, #tm-edit-modal, #tm-emote-picker-modal, #tm-modal-overlay, #tm-preview-container');
        };
        const pageObserver = new MutationObserver(records => {
            const pageRecords = records.filter(record => {
                const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                if (target && isInternalNode(target)) return false;
                if (record.type === 'attributes' && target === document.body) return false;
                if (record.type === 'childList') {
                    const changedNodes = [...record.addedNodes, ...record.removedNodes];
                    if (changedNodes.length && changedNodes.every(isInternalNode)) return false;
                }
                return true;
            });
            if (!pageRecords.length) return;
            pendingPageRecords.push(...pageRecords);
            if (updateScheduled) return;
            updateScheduled = true;
            requestAnimationFrame(() => {
                const currentRecords = pendingPageRecords;
                pendingPageRecords = [];
                const hasStructureChange = currentRecords.some(record => record.type === 'childList');
                const hasEmoteChange = currentRecords.some(record => {
                    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                    if (target?.closest('.seventv-chat-list, [data-test-selector="chat-scrollable-area__message-container"]')) return true;
                    if (record.type === 'attributes') {
                        return ['alt', 'src', 'srcset', 'data-emote-name'].includes(record.attributeName) && target?.matches('img');
                    }
                    return [...record.addedNodes].some(node => {
                        if (node.nodeType !== 1) return false;
                        return node.matches('img.seventv-chat-emote, img[class*="seventv"][alt], img[data-emote-name], img.chat-image[alt], img.chat-line__message--emote') ||
                            !!node.querySelector('img.seventv-chat-emote, img[class*="seventv"][alt], img[data-emote-name], img.chat-image[alt], img.chat-line__message--emote');
                    });
                });
                if (hasStructureChange) setupSpoilers();
                if (hasEmoteChange) collectEmotes();
                if (refreshAutoChatVisibility) refreshAutoChatVisibility();
                if (refreshChatListeners) refreshChatListeners();
                if (refreshChannelState) refreshChannelState();
                updateScheduled = false;
            });
        });
        pageObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-selected', 'role', 'href', 'data-a-target', 'data-test-selector', 'aria-label', 'alt', 'src', 'srcset', 'data-emote-name']
        });
    }
    function boot() {
        if (document.body) {
            initScript();
            return;
        }
        const startupObserver = new MutationObserver(() => {
            if (!document.body) return;
            startupObserver.disconnect();
            initScript();
        });
        startupObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    boot();
})();