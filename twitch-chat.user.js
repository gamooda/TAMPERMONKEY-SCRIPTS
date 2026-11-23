// ==UserScript==
// @name         StreamChat Assistant
// @namespace    twitch-panels-telegram-spoiler
// @version      13.2
// @description  Unified chat automation, message history and native emote picker for Twitch and Kick
// @updateURL    https://raw.githubusercontent.com/gamooda/TAMPERMONKEY-SCRIPTS/main/twitch-chat.user.js
// @downloadURL  https://raw.githubusercontent.com/gamooda/TAMPERMONKEY-SCRIPTS/main/twitch-chat.user.js
// @icon         https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png
// @match        https://www.twitch.tv/*
// @match        https://kick.com/*
// @match        https://www.kick.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
(function () {
    'use strict';
    const STORAGE_KEY = 'tm-autochat-v10'; const MAX_CHARS = 500; const HOLD_SEND_MS = 1000;
    function getPlatform() {
        return /(^|\.)kick\.com$/i.test(location.hostname) ? 'kick' : 'twitch';
    }
    function getPlatformLabel(platform) {
        return platform === 'kick' ? 'KICK' : 'TWITCH';
    }
    function getHistoryChannelKey(channel) {
        return (channel?.platform === 'kick' ? 'kick' : 'twitch') + ':' + (channel?.name || 'unknown');
    }
    function normalizeStoredHistory(data, fallbackPlatform) {
        if (!data || typeof data !== 'object') return {};
        if (!Array.isArray(data.history)) data.history = [];
        data.history.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            if (entry.channel && typeof entry.channel === 'object') {
                if (!['twitch', 'kick'].includes(entry.channel.platform)) entry.channel.platform = fallbackPlatform;
            }
            if (!Array.isArray(entry.pinnedIn)) entry.pinnedIn = [];
            const platform = entry.channel?.platform === 'kick' ? 'kick' : 'twitch';
            entry.pinnedIn = entry.pinnedIn.map(pin => {
                if (['all', 'unknown', 'all-pastes'].includes(pin) || String(pin).includes(':')) return pin;
                return platform + ':' + pin;
            });
        });
        return data;
    }
    function getHistoryIdentity(entry) {
        const channel = entry?.channel || {};
        const platform = channel.platform === 'kick' ? 'kick' : 'twitch';
        const name = channel.name || 'unknown';
        return JSON.stringify([platform, name, entry?.variants || [entry?.text || '']]);
    }
    function loadData() {
        let localData = {};
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) localData = normalizeStoredHistory(JSON.parse(raw), 'twitch');
        } catch {}
        if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
            try {
                let sharedData = GM_getValue(STORAGE_KEY, null);
                if (sharedData && typeof sharedData === 'object' && !Array.isArray(sharedData)) sharedData = normalizeStoredHistory(sharedData, 'twitch');
                if (!sharedData || typeof sharedData !== 'object' || Array.isArray(sharedData)) {
                    sharedData = localData;
                    GM_setValue(STORAGE_KEY, sharedData);
                    localStorage.removeItem(STORAGE_KEY);
                    return sharedData;
                }
                if (localData && Object.keys(localData).length) {
                    const merged = { ...sharedData };
                    Object.keys(localData).forEach(key => {
                        if (key !== 'history' && merged[key] === undefined) merged[key] = localData[key];
                    });
                    const history = Array.isArray(merged.history) ? merged.history.slice() : [];
                    const identities = new Set(history.map(getHistoryIdentity));
                    (localData.history || []).forEach(entry => {
                        const identity = getHistoryIdentity(entry);
                        if (!identities.has(identity)) {
                            identities.add(identity);
                            history.push(entry);
                        }
                    });
                    merged.history = history;
                    sharedData = merged;
                    GM_setValue(STORAGE_KEY, sharedData);
                    localStorage.removeItem(STORAGE_KEY);
                }
                return sharedData;
            } catch {}
        }
        return localData;
    }
    function saveData(data) {
        if (typeof GM_setValue === 'function') {
            try {
                GM_setValue(STORAGE_KEY, data);
                localStorage.removeItem(STORAGE_KEY);
                return;
            } catch {}
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    function getSettings() {
        const d = loadData();
        return {
            cleanHiddenChars: d.cleanHiddenChars !== false,
            spoilerEnabled: d.spoilerEnabled !== false,
            spoilerNeverReveal: !!d.spoilerNeverReveal
        };
    }
    const STYLE_ID = 'tm-telegram-spoiler-style';
    let refreshAutoChatVisibility = null; let refreshChatListeners = null; let refreshChannelState = null;
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
#tm-autochat-toggle-btn { position: fixed !important; top: 50%; right: 0; transform: translate(0, -50%); width: 24px; height: 60px; background: #18181b; border: 1px solid #2f2f35; border-right: none; border-radius: 8px 0 0 8px; color: #efeff1; z-index: 2147483647 !important; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; opacity: 0; visibility: hidden; pointer-events: none; transition: right 0s linear, transform 0.3s ease, background 0.2s; will-change: right, transform, opacity; }
#tm-autochat-toggle-btn.visible { opacity: 1; visibility: visible; pointer-events: auto; animation: tm-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, tm-pulse 1s ease-in-out 3 0.4s; }
#tm-autochat-toggle-btn:hover { background: #2f2f35; }
#tm-autochat-toggle-btn.open { transform: translate(-380px, -50%); animation: none; }
#tm-autochat-panel { position: fixed !important; top: 50%; right: 0; width: 380px; height: 650px; max-height: 85vh; background: #18181b; border: 1px solid #2f2f35; border-radius: 12px 0 0 12px; z-index: 2147483646 !important; isolation: isolate; color: #efeff1; font-family: Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif; box-shadow: -12px 0 40px rgba(0,0,0,.6); user-select: none; overflow: hidden; display: flex; flex-direction: column; transform: translate(100%, -50%); opacity: 0; visibility: hidden; pointer-events: none; transition: right 0s linear, transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease, visibility 0.3s ease; will-change: right, transform; }
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
@keyframes tmPreviewIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.tm-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 2147483647; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.2s; }
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
    const emoteMap = new Map();
    const channelEmoteNames = new Set();
    const discoveredEmoteNames = new Set();
    const kickNativeEmoteNames = new Set();
    const globalSevenTVEmotes = new Map();
    const globalTwitchEmotes = new Map();
    let globalEmotesLoaded = false;
    let twitchGlobalEmotesLoaded = false;
    let twitchGlobalEmotePromise = null;
    let activeSevenTVChannel = '';
    let sevenTVRequestId = 0;
    let sevenTVRetryTimer = null;
    let sevenTVRetryCount = 0;
    function notifyEmotesUpdated() {
        try { document.dispatchEvent(new CustomEvent('tm-emotes-updated')); } catch {}
    }
    function collectEmotes() {
        let changed = false;
        if (getPlatform() === 'kick') {
            const selectors = [
                'img[src*="files.kick.com/emotes/"]',
                'img[data-emote-name]',
                'span[data-emote-name]',
                'img[alt][data-testid*="emote"]'
            ].join(',');
            document.querySelectorAll(selectors).forEach(node => {
                if (node.closest('#tm-autochat-panel, #tm-preview-container, #tm-emote-picker-modal')) return;
                const name = (node.getAttribute('alt') || node.getAttribute('data-emote-name') || node.getAttribute('title') || node.closest('[data-emote-name]')?.getAttribute('data-emote-name') || node.closest('button')?.getAttribute('aria-label') || node.closest('button')?.getAttribute('title') || '').trim();
                const img = node.matches('img') ? node : node.querySelector('img');
                const src = img?.currentSrc || img?.src || img?.getAttribute('data-src') || node.getAttribute('data-src') || '';
                if (!name || name.length > 48 || !src) return;
                try { if (new URL(src, location.href).hostname !== 'files.kick.com') return; } catch { return; }
                if (!kickNativeEmoteNames.has(name)) {
                    kickNativeEmoteNames.add(name);
                    changed = true;
                }
                const existing = emoteMap.get(name);
                if (!existing || existing.src !== src) {
                    emoteMap.set(name, { src, srcset: img?.getAttribute('srcset') || '' });
                    changed = true;
                }
            });
            if (changed) {
                notifyEmotesUpdated();
                document.dispatchEvent(new CustomEvent('tm-kick-emotes-updated', { detail: { count: kickNativeEmoteNames.size } }));
            }
            return;
        }
        const selectors = [
            'img.seventv-chat-emote',
            'img[class*="seventv"][alt]',
            'img[data-emote-name]',
            'img[data-a-target="emote-name"]',
            'img.chat-image[alt]',
            'img.chat-line__message--emote',
            'img[src*="static-cdn.jtvnw.net/emoticons/v2"][alt]'
        ].join(',');
        document.querySelectorAll(selectors).forEach(img => {
            if (img.closest('#tm-autochat-panel, #tm-preview-container, #tm-emote-picker-modal')) return;
            const name = (img.getAttribute('alt') || img.getAttribute('data-emote-name') || img.getAttribute('title') || '').trim();
            if (!name || name.length > 40) return;
            const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
            const srcset = img.getAttribute('srcset') || '';
            if (!src && !srcset) return;
            if (!discoveredEmoteNames.has(name)) {
                discoveredEmoteNames.add(name);
                changed = true;
            }
            const existing = emoteMap.get(name);
            if (existing) {
                const existingScore = (existing.src ? 1 : 0) + (existing.srcset ? 1 : 0);
                const newScore = (src ? 1 : 0) + (srcset ? 1 : 0);
                if (existingScore >= newScore) return;
            }
            emoteMap.set(name, { src, srcset });
            changed = true;
        });
        if (changed) notifyEmotesUpdated();
    }
    function clearKickNativeEmotes() {
        kickNativeEmoteNames.forEach(name => {
            if (!channelEmoteNames.has(name) && !discoveredEmoteNames.has(name) && !globalSevenTVEmotes.has(name)) emoteMap.delete(name);
        });
        kickNativeEmoteNames.clear();
        notifyEmotesUpdated();
    }
    function addSevenTVEmotes(emotes, isChannel = false) {
        if (!Array.isArray(emotes)) return false;
        let changed = false;
        for (const emote of emotes) {
            if (!emote || !emote.name || !emote.id || emote.name.length > 40) continue;
            const name = emote.name;
            const base = 'https://cdn.7tv.app/emote/' + emote.id;
            const data = {
                src: base + '/2x.webp',
                srcset: base + '/1x.webp 1x, ' + base + '/2x.webp 2x, ' + base + '/3x.webp 3x, ' + base + '/4x.webp 4x'
            };
            if (isChannel) {
                channelEmoteNames.add(name);
                const existing = emoteMap.get(name);
                if (existing && existing.src === data.src && existing.srcset === data.srcset) continue;
                emoteMap.set(name, data);
                changed = true;
            } else {
                const previousGlobal = globalSevenTVEmotes.get(name);
                globalSevenTVEmotes.set(name, data);
                if (!channelEmoteNames.has(name) && !emoteMap.has(name)) {
                    emoteMap.set(name, data);
                    changed = true;
                }
                if (!previousGlobal || previousGlobal.src !== data.src || previousGlobal.srcset !== data.srcset) changed = true;
            }
        }
        return changed;
    }
    function getGlobalEmote(name) {
        return globalSevenTVEmotes.get(name) || globalTwitchEmotes.get(name) || null;
    }
    function applyTwitchGlobalEmotes(emotes) {
        if (!Array.isArray(emotes)) return 0;
        let changed = false;
        for (const emote of emotes) {
            if (!emote || typeof emote.name !== 'string' || !emote.name.trim() || emote.name.length > 40) continue;
            const imageUrl = String(emote.imageUrl || '');
            if (!/^https:\/\/static-cdn\.jtvnw\.net\/emoticons\/v2\//i.test(imageUrl)) continue;
            const sizedUrl = size => imageUrl.replace(/\/(?:1|2|3|4)\.0(?:\?.*)?$/, '/' + size + '.0');
            const data = {
                src: sizedUrl(2),
                srcset: sizedUrl(1) + ' 1x, ' + sizedUrl(2) + ' 2x, ' + sizedUrl(3) + ' 3x'
            };
            const name = emote.name.trim();
            const previous = globalTwitchEmotes.get(name);
            if (!previous || previous.src !== data.src) {
                globalTwitchEmotes.set(name, data);
                changed = true;
            }
            if (!channelEmoteNames.has(name) && !discoveredEmoteNames.has(name) && !emoteMap.has(name)) {
                emoteMap.set(name, data);
                changed = true;
            }
        }
        if (changed) notifyEmotesUpdated();
        return globalTwitchEmotes.size;
    }
    function clearChannelSevenTVEmotes(channelLogin) {
        sevenTVRequestId++;
        if (sevenTVRetryTimer) clearTimeout(sevenTVRetryTimer);
        sevenTVRetryTimer = null;
        sevenTVRetryCount = 0;
        activeSevenTVChannel = channelLogin || '';
        channelEmoteNames.forEach(name => {
            const globalEmote = getGlobalEmote(name);
            if (globalEmote) emoteMap.set(name, globalEmote);
            else if (!discoveredEmoteNames.has(name)) emoteMap.delete(name);
        });
        discoveredEmoteNames.forEach(name => {
            if (channelEmoteNames.has(name)) return;
            const globalEmote = getGlobalEmote(name);
            if (globalEmote) emoteMap.set(name, globalEmote);
            else emoteMap.delete(name);
        });
        channelEmoteNames.clear();
        discoveredEmoteNames.clear();
        notifyEmotesUpdated();
    }
    function replaceChannelSevenTVEmotes(emotes) {
        channelEmoteNames.forEach(name => {
            const globalEmote = getGlobalEmote(name);
            if (globalEmote) emoteMap.set(name, globalEmote);
            else emoteMap.delete(name);
        });
        channelEmoteNames.clear();
        addSevenTVEmotes(emotes, true);
        notifyEmotesUpdated();
        return channelEmoteNames.size;
    }
    async function requestWithRetry(urls, asJson = true, timeoutMs = 6500) {
        for (const baseUrl of urls) {
            for (let attempt = 0; attempt < 2; attempt++) {
                const separator = baseUrl.includes('?') ? '&' : '?';
                const url = baseUrl + separator + 'tm_cache=' + Date.now() + '_' + attempt + '_' + Math.random().toString(36).slice(2);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        cache: 'no-store',
                        credentials: 'omit',
                        headers: { Accept: '*/*' },
                        signal: controller.signal
                    });
                    if (response.status === 429 || response.status >= 500) {
                        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
                        continue;
                    }
                    if (!response.ok) break;
                    return asJson ? await response.json() : await response.text();
                } catch {
                    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
                } finally {
                    clearTimeout(timeout);
                }
            }
        }
        return null;
    }
    function sevenTVApiUrls(path) {
        return ['https://7tv.io/v3' + path, 'https://api.7tv.app/v3' + path];
    }
    async function requestSevenTVApi(path) {
        return requestWithRetry(sevenTVApiUrls(path), true, 6500);
    }
    async function loadTwitchGlobalEmotes() {
        if (twitchGlobalEmotesLoaded) return globalTwitchEmotes.size;
        if (twitchGlobalEmotePromise) return twitchGlobalEmotePromise;
        twitchGlobalEmotePromise = (async () => {
            const data = await requestWithRetry(['https://api.limerino.com/public/twitch-emotes?view=current'], true, 8000);
            if (data && Array.isArray(data.emotes)) {
                const count = applyTwitchGlobalEmotes(data.emotes);
                twitchGlobalEmotesLoaded = true;
                return count;
            }
            return globalTwitchEmotes.size;
        })();
        try {
            return await twitchGlobalEmotePromise;
        } finally {
            twitchGlobalEmotePromise = null;
        }
    }
    if (getPlatform() === 'twitch') {
        applyTwitchGlobalEmotes([
            { name: 'Kreygasm', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/41/static/light/3.0' },
            { name: 'RaccAttack', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/114870/static/light/3.0' }
        ]);
        loadTwitchGlobalEmotes();
    }
    async function getTwitchUserId(login) {
        if (!login) return null;
        const encoded = encodeURIComponent(login.toLowerCase());
        const results = await Promise.all([
            requestWithRetry(['https://decapi.me/twitch/id/' + encoded], false, 5500),
            requestWithRetry(['https://api.ivr.fi/v2/twitch/user?login=' + encoded], true, 5500)
        ]);
        const decapiId = String(results[0] || '').trim();
        if (/^\d+$/.test(decapiId)) return decapiId;
        const ivrData = results[1];
        if (Array.isArray(ivrData) && ivrData[0] && ivrData[0].id) return String(ivrData[0].id);
        if (ivrData && ivrData.id) return String(ivrData.id);
        return null;
    }
    function getSevenTVUserSearchResults(data) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return [];
        if (Array.isArray(data.users)) return data.users;
        if (Array.isArray(data.results)) return data.results;
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data.items)) return data.items;
        return [];
    }
    async function findSevenTVUserByLogin(login, isCurrentRequest) {
        const data = await requestSevenTVApi('/users?query=' + encodeURIComponent(login));
        if (!isCurrentRequest() || !data) return null;
        const users = getSevenTVUserSearchResults(data);
        return users.find(user => {
            const directName = String(user.username || '').toLowerCase();
            const connectionMatch = Array.isArray(user.connections) && user.connections.some(connection =>
                String(connection.platform || '').toLowerCase() === 'twitch' &&
                String(connection.username || '').toLowerCase() === login.toLowerCase()
            );
            return directName === login.toLowerCase() || connectionMatch;
        }) || null;
    }
    async function getSevenTVEmotesFromUser(data, isCurrentRequest) {
        if (!data || typeof data !== 'object') return null;
        if (data.emote_set && Array.isArray(data.emote_set.emotes)) return data.emote_set.emotes;
        if (Array.isArray(data.emotes)) return data.emotes;
        const connections = Array.isArray(data.connections) ? data.connections : [];
        const twitchConnection = connections.find(connection => String(connection.platform || '').toLowerCase() === 'twitch') ||
            (String(data.platform || '').toLowerCase() === 'twitch' ? data : null);
        const linkedSet = twitchConnection && twitchConnection.emote_set;
        if (linkedSet && Array.isArray(linkedSet.emotes)) return linkedSet.emotes;
        if (data.emote_set && Array.isArray(data.emote_set.emotes)) return data.emote_set.emotes;
        const linkedSetId = (twitchConnection && twitchConnection.emote_set_id) ||
            data.emote_set_id ||
            (data.emote_set && data.emote_set.id);
        if (linkedSetId) {
            const setData = await requestSevenTVApi('/emote-sets/' + encodeURIComponent(linkedSetId));
            if (!isCurrentRequest()) return null;
            if (setData && Array.isArray(setData.emotes)) return setData.emotes;
            return null;
        }
        const partialSets = Array.isArray(data.emote_sets) ? data.emote_sets : [];
        const fullSets = partialSets.filter(set => set && Array.isArray(set.emotes));
        if (fullSets.length) return fullSets.flatMap(set => set.emotes);
        const setIds = partialSets.map(set => set && (set.id || set.emote_set_id)).filter(Boolean);
        if (setIds.length) {
            const combined = [];
            let loadedAny = false;
            for (const setId of setIds) {
                const setData = await requestSevenTVApi('/emote-sets/' + encodeURIComponent(setId));
                if (!isCurrentRequest()) return null;
                if (setData && Array.isArray(setData.emotes)) {
                    combined.push(...setData.emotes);
                    loadedAny = true;
                }
            }
            return loadedAny ? combined : null;
        }
        if (twitchConnection || Array.isArray(data.connections) || Array.isArray(data.emote_sets)) return [];
        return null;
    }
    function emitSevenTVLoadStatus(channelLogin, count, retrying = false, attempt = 0, delay = 0) {
        document.dispatchEvent(new CustomEvent('tm-7tv-emotes-loaded', {
            detail: { channel: channelLogin, count, retrying, attempt, delay }
        }));
    }
    function scheduleSevenTVRetry(channelLogin, requestId) {
        const delays = [2500, 6000, 12000];
        if (sevenTVRetryCount >= delays.length) {
            emitSevenTVLoadStatus(channelLogin, null, false, sevenTVRetryCount, 0);
            return;
        }
        const delay = delays[sevenTVRetryCount];
        sevenTVRetryCount++;
        emitSevenTVLoadStatus(channelLogin, null, true, sevenTVRetryCount, delay);
        if (sevenTVRetryTimer) clearTimeout(sevenTVRetryTimer);
        sevenTVRetryTimer = setTimeout(() => {
            sevenTVRetryTimer = null;
            if (activeSevenTVChannel !== channelLogin || requestId !== sevenTVRequestId) return;
            fetchSevenTVEmotes(channelLogin);
        }, delay);
    }
    async function fetchSevenTVEmotes(channelLogin) {
        if (!channelLogin || ['directory', 'popout', 'videos', 'settings'].includes(channelLogin)) return null;
        if (activeSevenTVChannel !== channelLogin) clearChannelSevenTVEmotes(channelLogin);
        const requestId = ++sevenTVRequestId;
        const isCurrentRequest = () => requestId === sevenTVRequestId && activeSevenTVChannel === channelLogin;
        try {
            if (!globalEmotesLoaded) {
                const globalData = await requestSevenTVApi('/emote-sets/global');
                if (!isCurrentRequest()) return null;
                if (globalData && Array.isArray(globalData.emotes)) {
                    addSevenTVEmotes(globalData.emotes, false);
                    globalEmotesLoaded = true;
                }
            }
            if (!isCurrentRequest()) return null;
            const twitchId = await getTwitchUserId(channelLogin);
            if (!isCurrentRequest()) return null;
            let userData = null;
            if (twitchId) {
                userData = await requestSevenTVApi('/users/twitch/' + encodeURIComponent(twitchId));
                if (!isCurrentRequest()) return null;
            }
            let emotes = await getSevenTVEmotesFromUser(userData, isCurrentRequest);
            if (!isCurrentRequest()) return null;
            if (!Array.isArray(emotes)) {
                const searchedUser = await findSevenTVUserByLogin(channelLogin, isCurrentRequest);
                if (!isCurrentRequest()) return null;
                if (searchedUser) emotes = await getSevenTVEmotesFromUser(searchedUser, isCurrentRequest);
            }
            if (!isCurrentRequest()) return null;
            if (!Array.isArray(emotes)) throw new Error('7TV emote set unavailable');
            const count = replaceChannelSevenTVEmotes(emotes);
            if (sevenTVRetryTimer) clearTimeout(sevenTVRetryTimer);
            sevenTVRetryTimer = null;
            sevenTVRetryCount = 0;
            emitSevenTVLoadStatus(channelLogin, count);
            return count;
        } catch {
            if (isCurrentRequest()) scheduleSevenTVRetry(channelLogin, requestId);
            return null;
        }
    }
    async function refreshSevenTVEmotes(channelLogin) {
        if (!channelLogin || ['directory', 'popout', 'videos', 'settings'].includes(channelLogin)) return null;
        if (activeSevenTVChannel !== channelLogin) clearChannelSevenTVEmotes(channelLogin);
        if (sevenTVRetryTimer) clearTimeout(sevenTVRetryTimer);
        sevenTVRetryTimer = null;
        sevenTVRetryCount = 0;
        sevenTVRequestId++;
        return fetchSevenTVEmotes(channelLogin);
    }
    collectEmotes();
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
        const platform = getPlatform();
        const parts = window.location.pathname.split('/').filter(Boolean);
        const first = (parts[0] || '').toLowerCase();
        const kickNonChannelRoutes = new Set(['', 'home', 'browse', 'following', 'categories', 'category', 'search', 'login', 'register', 'dashboard', 'settings', 'clips', 'videos', 'subscriptions', 'notifications', 'messages', 'wallet', 'terms-of-service', 'privacy-policy', 'cookie-policy', 'community-guidelines', 'dmca-policy']);
        const channelName = platform === 'kick'
            ? (first === 'popout' ? (parts[1] || '') : (kickNonChannelRoutes.has(first) ? '' : (parts[0] || ''))).toLowerCase()
            : (['directory', 'popout', 'videos', 'settings'].includes(first) ? '' : first);
        let displayName = channelName;
        if (platform === 'twitch') {
            const nameEl = document.querySelector('[data-a-target="channel-info"] h1, h1[data-test-selector="channel-header-title"], .channel-info-content h1');
            if (nameEl && nameEl.textContent.trim()) displayName = nameEl.textContent.trim();
        } else {
            const nameEl = document.querySelector('[data-testid="channel-title"], [data-testid="channel-name"], h1');
            if (nameEl && nameEl.textContent.trim() && nameEl.textContent.trim().length < 80) displayName = nameEl.textContent.trim().replace(/^@/, '');
            else if (kickChannelSettings.slug === channelName && kickChannelSettings.username) displayName = kickChannelSettings.username;
        }
        return { platform, name: channelName, displayName, avatar: getAvatarUrl(channelName, platform) };
    }
    function getAvatarUrl(name, platform = getPlatform()) {
        if (!name || name === 'unknown' || name === 'all') return '';
        const safeName = String(name).toLowerCase();
        if (platform === 'kick') {
            if (kickChannelSettings.slug === safeName && kickChannelSettings.avatar) return kickChannelSettings.avatar;
            const link = document.querySelector('a[href="/' + safeName + '"], a[href="/' + safeName + '/"]');
            const img = link?.querySelector('img');
            return img?.src || '';
        }
        const userEl = document.querySelector(`[data-a-user="${safeName}"]`);
        if (userEl) {
            const img = userEl.querySelector('img');
            if (img && img.src) return img.src;
        }
        const sidebarLinks = document.querySelectorAll('a[href="/' + safeName + '"]');
        for (const link of sidebarLinks) {
            const img = link.querySelector('img');
            if (img && img.src) return img.src;
        }
        return `https://unavatar.io/twitch/${encodeURIComponent(safeName)}`;
    }
    function renderAvatar(name, size = 16, platform = getPlatform()) {
        const url = getAvatarUrl(name, platform);
        const initials = escapeHtml((name || (platform === 'kick' ? 'K' : 'T')).slice(0, 1).toUpperCase());
        const background = platform === 'kick' ? '#53fc18' : '#9147ff';
        return url
            ? `<img src="${escapeHtml(url)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='<span style=&quot;width:${size}px;height:${size}px;border-radius:50%;background:${background};color:#111;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.max(9,Math.floor(size*.58))}px;font-weight:800;flex-shrink:0;&quot;>${initials}</span>';">`
            : `<span style="width:${size}px;height:${size}px;border-radius:50%;background:${background};color:#111;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.max(9,Math.floor(size*.58))}px;font-weight:800;flex-shrink:0;">${initials}</span>`;
    }
    function findChatInput() {
        if (getPlatform() === 'kick') {
            return findVisibleKickElement('#chat-input-wrapper [data-lexical-editor="true"], .editor-input[data-lexical-editor="true"], #chat-input, [data-testid="chat-input"], #chat-input-wrapper [contenteditable="true"], [contenteditable="true"][placeholder]');
        }
        return document.querySelector('div[data-a-target="chat-input"]');
    }
    function findSendButton() {
        return getPlatform() === 'kick'
            ? findVisibleKickElement('#send-message-button')
            : document.querySelector('button[data-a-target="chat-send-button"]');
    }
    let kickChannelSettings = { slug: '', username: '', avatar: '', followersMode: false, subscribersMode: false, slowMode: false, messageInterval: 0 };
    let kickSettingsRequestId = 0;
    async function loadKickChannelSettings(slug) {
        if (!slug) return;
        const requestId = ++kickSettingsRequestId;
        kickChannelSettings = { slug, username: '', avatar: '', followersMode: false, subscribersMode: false, slowMode: false, messageInterval: 0 };
        try {
            const response = await fetch('/api/v2/channels/' + encodeURIComponent(slug), { credentials: 'include', cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            if (requestId !== kickSettingsRequestId || getPlatform() !== 'kick' || getChannelInfo().name !== slug) return;
            const chatroom = data?.chatroom || {};
            kickChannelSettings = {
                slug,
                username: String(data?.user?.username || slug),
                avatar: String(data?.user?.profile_pic || ''),
                followersMode: !!chatroom.followers_mode,
                subscribersMode: !!chatroom.subscribers_mode,
                slowMode: !!chatroom.slow_mode,
                messageInterval: Math.max(0, Number(chatroom.message_interval) || 0)
            };
            document.dispatchEvent(new CustomEvent('tm-kick-chat-settings-updated'));
        } catch {}
    }
    function getChatRestriction() {
        if (getPlatform() === 'kick') {
            const input = findChatInput();
            const chatArea = input?.closest('.flex.grow.flex-col.gap-2') || input?.closest('.relative') || input?.parentElement?.parentElement || document.body;
            const restrictionText = chatArea?.querySelector('div[class*="pointer-events-none"]')?.innerText || chatArea?.innerText || '';
            const text = restrictionText.toLowerCase();
            if (/timed out from chat|you are timed out|временно отстранен/.test(text)) return { type: 'timeout', message: 'Вы временно отстранены от чата Kick' };
            if (/banned from chat|you are banned|заблокирован в чате/.test(text)) return { type: 'ban', message: 'Вы заблокированы в чате Kick' };
            if (input && (input.getAttribute('contenteditable') === 'false' || input.getAttribute('aria-disabled') === 'true')) {
                if (kickChannelSettings.subscribersMode) return { type: 'subscribers', message: 'Для отправки сообщений требуется подписка на канал Kick' };
                if (kickChannelSettings.followersMode) return { type: 'followers', message: 'Для отправки сообщений нужно подписаться на канал Kick' };
                return { type: 'restricted', message: 'Поле ввода чата Kick отключено' };
            }
            return null;
        }
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
    function getFollowersOnlyInfo() {
        if (getPlatform() === 'kick') {
            if (kickChannelSettings.subscribersMode) return 'subscribers';
            if (kickChannelSettings.followersMode) return 'followers';
            return false;
        }
        const patterns = [
            /чат\s+только\s+для\s+(?:фолловеров|подписчиков)/i,
            /только\s+(?:фолловеры|подписчики)\b.{0,120}(?:чат|писать|отправлять сообщения|общаться)/i,
            /(?:для общения в чате|чтобы писать в чат|чтобы общаться в чате).{0,120}(?:нужно|необходимо|требуется|должны).{0,80}(?:фолловер|подписчик|отслеживать)/i,
            /followers?[-\s]+only(?:\s+chat)?/i,
            /chat\s+is\s+in\s+followers?[-\s]+only\s+mode/i,
            /(?:to chat|chatting|participate in chat).{0,120}(?:must|need to|required to) follow/i,
            /(?:must|need to|required to) follow.{0,140}(?:chat|participat|send messages)/i
        ];
        const selectors = '[data-a-target="chat-rules-banner"], [data-test-selector*="chat-rules"], [data-a-target*="followers-only"], [class*="chat-rules"], [class*="followers-only"], [role="alert"]';
        const candidates = new Set(document.querySelectorAll(selectors));
        const chatInput = document.querySelector('[data-a-target="chat-input"]');
        if (chatInput) {
            const area = chatInput.closest('.chat-input') || chatInput.parentElement?.parentElement || chatInput.parentElement;
            if (area) {
                candidates.add(area);
                area.querySelectorAll(selectors + ', p, span, div, [data-a-target], [data-test-selector]').forEach(node => candidates.add(node));
            }
            let current = chatInput;
            let depth = 0;
            while (current && current.parentElement && depth++ < 8) {
                let sibling = current.previousElementSibling;
                let count = 0;
                while (sibling && count++ < 3) {
                    candidates.add(sibling);
                    sibling.querySelectorAll(selectors + ', p, span, div, [data-a-target], [data-test-selector]').forEach(node => candidates.add(node));
                    sibling = sibling.previousElementSibling;
                }
                sibling = current.nextElementSibling;
                count = 0;
                while (sibling && count++ < 2) {
                    candidates.add(sibling);
                    sibling.querySelectorAll(selectors + ', p, span, div, [data-a-target], [data-test-selector]').forEach(node => candidates.add(node));
                    sibling = sibling.nextElementSibling;
                }
                current = current.parentElement;
            }
        }
        for (const element of candidates) {
            if (!element || !element.isConnected) continue;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || !element.getClientRects().length) continue;
            const text = (element.innerText || element.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (text && text.length <= 900 && patterns.some(pattern => pattern.test(text))) return true;
        }
        return false;
    }
    function getSlowModeInfo() {
        if (getPlatform() === 'kick') return kickChannelSettings.slowMode ? kickChannelSettings.messageInterval : 0;
        const chatArea = document.querySelector('.chat-room') || document.querySelector('[data-test-selector="chat-room-component-layout"]') || document.body; const text = (chatArea.innerText || ''); const ruMatch = text.match(/медленный режим[^0-9]*(\d+)\s*секунд/i);
        if (ruMatch) return parseInt(ruMatch[1], 10);
        const enMatch = text.match(/slow mode[^0-9]*(\d+)\s*second/i);
        if (enMatch) return parseInt(enMatch[1], 10);
        return 0;
    }
    function cleanChatText(text) {
        const value = String(text || '');
        return getSettings().cleanHiddenChars
            ? value.replace(/[\u200B\u200C\u2060\uFEFF]/g, '').replace(/\u200D{2,}$/g, '').trim()
            : value.trim();
    }
    function isKickElementVisible(element) {
        if (!element || !element.isConnected || !element.getClientRects().length) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        let current = element;
        while (current && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
            current = current.parentElement;
        }
        return true;
    }
    function findVisibleKickElement(selector) {
        return Array.from(document.querySelectorAll(selector)).find(isKickElementVisible) || null;
    }
    function getKickInputText(input) {
        return String(input?.innerText || input?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function kickInputHasContent(input) {
        return !!getKickInputText(input) || !!input?.querySelector('img, [data-emote-name], [data-lexical-decorator="true"]');
    }
    function selectKickInput(input) {
        input.focus({ preventScroll: true });
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    async function clearKickChatInput(input) {
        selectKickInput(input);
        try { document.execCommand('delete', false, null); } catch {}
        await new Promise(resolve => setTimeout(resolve, 80));
        if (kickInputHasContent(input)) {
            selectKickInput(input);
            try { document.execCommand('selectAll', false, null); } catch {}
            try { document.execCommand('delete', false, null); } catch {}
            input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true, composed: true }));
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return !kickInputHasContent(input);
    }
    async function sendKickChatMessage(input, text) {
        const cleared = await clearKickChatInput(input);
        if (!cleared) return { ok: false, restriction: { type: 'input', message: 'Не удалось очистить поле Kick. Сообщение не отправлено.' } };
        input.focus({ preventScroll: true });
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        try { document.execCommand('insertText', false, text); } catch {}
        await new Promise(resolve => setTimeout(resolve, 150));
        const actualText = getKickInputText(input);
        const expectedText = String(text).replace(/\s+/g, ' ').trim();
        if (!actualText || actualText !== expectedText) return { ok: false, restriction: { type: 'input', message: 'Kick не подтвердил вставку текста. Сообщение не отправлено.' } };
        const button = findSendButton();
        if (button && !button.disabled && isKickElementVisible(button)) {
            button.click();
            return { ok: true };
        }
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return { ok: true };
    }
    function clearChatInput(input) {
        input.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        try { document.execCommand('delete', false); } catch {}
        selection.removeAllRanges();
        if ((input.textContent || '').length) input.textContent = '';
        const cursor = document.createRange();
        cursor.selectNodeContents(input);
        cursor.collapse(false);
        selection.addRange(cursor);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    }
    async function sendChatMessage(text) {
        const restriction = getChatRestriction();
        if (restriction) return { ok: false, restriction };
        const input = findChatInput(); const btn = findSendButton();
        if (!input) return { ok: false, restriction: { type: 'noinput', message: 'Поле чата не найдено' } };
        const finalText = cleanChatText(text);
        if (!finalText) return { ok: false, restriction: { type: 'empty', message: 'Сообщение пустое после очистки скрытых символов' } };
        if (getPlatform() === 'kick') return sendKickChatMessage(input, finalText);
        clearChatInput(input);
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
    function playBeep() {}
    let livePreviewEl = null; let historyPreviewEl = null; let currentTab = 'send'; let isRunning = false;
    let isPausedByUser = false; let isAutoSending = false; let currentFilter = 'all'; let lastKnownChannel = '';
    let activeHistoryIdx = -1; let currentEmoteTarget = null;
    function removeLivePreview() {
        document.getElementById('tm-preview-container')?.remove();
    }
    function removeHistoryPreview() {
        document.getElementById('tm-preview-container')?.remove();
    }
    function updateLivePreview() {}
    function showHistoryPreview() { return false; }
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
                    <span class="tm-ac-header-title">StreamChat Assistant ${username ? '• ' + username : ''}</span>
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
                        <span class="tm-ac-followers-copy"><strong id="tm-ac-followers-title">Включён чат только для фолловеров</strong><small id="tm-ac-followers-detail">Отправка сообщений ограничена настройками канала.</small></span>
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
                        <input type="checkbox" id="tm-ac-clean-hidden" ${settings.cleanHiddenChars ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Удалять скрытые символы</span><small>Убирает невидимые символы из пасты перед отправкой.</small></span>
                    </label>

                    <div id="tm-ac-7tv-settings-block">
                        <div class="tm-ac-section-title">Смайлы 7TV</div>
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            <button id="tm-ac-7tv-refresh" class="tm-ac-hist-btn" style="width:100%; padding:8px;">↻ Обновить смайлы 7TV канала</button>
                            <small id="tm-ac-7tv-status" style="color:#adadb8; font-size:11px; line-height:1.4;">Смайлы загружаются автоматически при переходе на канал.</small>
                        </div>
                    </div>
                    <div id="tm-ac-kick-emotes-info" hidden>
                        <div class="tm-ac-section-title">Нативные смайлы Kick</div>
                        <small id="tm-ac-kick-emotes-status" style="color:#adadb8; font-size:11px; line-height:1.4;">Смайлы автоматически добавляются из чата и встроенного пикера Kick.</small>
                    </div>

                    <div class="tm-ac-section-title">Описание (баннеры)</div>
                    <label class="tm-ac-check">
                        <input type="checkbox" id="tm-ac-spoiler-enabled" ${settings.spoilerEnabled ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Размывать баннеры</span><small>Скрывает изображения баннеров под размытием до наведения курсора.</small></span>
                    </label>
                    <label class="tm-ac-check" id="tm-ac-spoiler-never-row">
                        <input type="checkbox" id="tm-ac-spoiler-never" ${settings.spoilerNeverReveal ? 'checked' : ''}>
                        <span class="tm-ac-check-copy"><span>Не показывать даже при наведении</span><small>Оставляет баннеры размытыми постоянно, пока включена защита.</small></span>
                    </label>

                    <div class="tm-ac-section-title">История</div>
                    <button id="tm-ac-clear-history" class="tm-ac-hist-btn" style="width:100%; padding:9px; color:#ff6b6b; background:#302023;">Удерживайте 3 секунды, чтобы очистить историю</button>
                    <small id="tm-ac-clear-history-status" class="tm-ac-desc">История удалится только после полного удержания кнопки.</small>

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
            const platform = getPlatform();
            const chatInput = findChatInput();
            let chatRoom = platform === 'kick'
                ? findVisibleKickElement('#channel-chatroom, #chatroom, [data-testid*="chatroom" i], [data-testid*="chat-room" i], #chat-container, [id*="chatroom" i]')
                : document.querySelector('section[data-test-selector="chat-room-component-layout"]') || document.querySelector('.chat-room');
            if (platform === 'kick' && !chatRoom && chatInput) {
                let ancestor = chatInput.parentElement;
                let depth = 0;
                while (ancestor && ancestor !== document.body && depth++ < 9) {
                    const rect = ancestor.getBoundingClientRect();
                    if (rect.width > 220 && rect.height > 220) {
                        chatRoom = ancestor;
                        break;
                    }
                    ancestor = ancestor.parentElement;
                }
            }
            if (chatRoom !== observedChatRoom) {
                if (observedChatRoom) chatRoomResizeObserver.unobserve(observedChatRoom);
                observedChatRoom = chatRoom;
                if (observedChatRoom) chatRoomResizeObserver.observe(observedChatRoom);
            }
            let isChatValid = false;
            if (platform === 'kick' && chatRoom && chatInput) {
                const roomRect = chatRoom.getBoundingClientRect();
                const inputRect = chatInput.getBoundingClientRect();
                const roomStyle = window.getComputedStyle(chatRoom);
                const inputStyle = window.getComputedStyle(chatInput);
                isChatValid = roomRect.width > 180 && roomRect.height > 180 &&
                    inputRect.width > 0 && inputRect.height > 0 &&
                    roomRect.left < window.innerWidth && roomRect.right > 0 &&
                    roomStyle.display !== 'none' && roomStyle.visibility !== 'hidden' &&
                    inputStyle.display !== 'none' && inputStyle.visibility !== 'hidden';
            } else if (platform === 'twitch' && !isChannelHomeNavigationVisible() && chatRoom && chatInput) {
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
        const statusEl = panel.querySelector('#tm-ac-status'); const historyList = panel.querySelector('#tm-ac-history-list'); const charCount = panel.querySelector('#tm-ac-char-count'); const cleanHiddenCharsCheck = panel.querySelector('#tm-ac-clean-hidden');
        const runStatusCard = panel.querySelector('#tm-ac-run-status'); const runStateEl = panel.querySelector('#tm-ac-run-state'); const runDetailEl = panel.querySelector('#tm-ac-run-detail'); const runValueEl = panel.querySelector('#tm-ac-run-value');
        const spoilerEnabledCheck = panel.querySelector('#tm-ac-spoiler-enabled'); const spoilerNeverCheck = panel.querySelector('#tm-ac-spoiler-never'); const spoilerNeverRow = panel.querySelector('#tm-ac-spoiler-never-row');
        const slowmodePill = panel.querySelector('#tm-ac-slowmode-pill'); const slowmodeText = panel.querySelector('#tm-ac-slowmode-text'); const followersOnlyStatusEl = panel.querySelector('#tm-ac-followers-status'); const followersOnlyTitleEl = panel.querySelector('#tm-ac-followers-title'); const followersOnlyDetailEl = panel.querySelector('#tm-ac-followers-detail'); const sevenTVRefreshBtn = panel.querySelector('#tm-ac-7tv-refresh'); const sevenTVRefreshStatus = panel.querySelector('#tm-ac-7tv-status'); const sevenTVSettingsBlock = panel.querySelector('#tm-ac-7tv-settings-block'); const kickEmotesInfo = panel.querySelector('#tm-ac-kick-emotes-info'); const kickEmotesStatus = panel.querySelector('#tm-ac-kick-emotes-status'); const filterWrapper = panel.querySelector('#tm-ac-history-filter-wrapper'); const filterHeader = panel.querySelector('#tm-ac-history-filter-header');
        const filterText = panel.querySelector('#tm-ac-history-filter-text'); const filterList = panel.querySelector('#tm-ac-history-filter-list'); const emoteSearch = emoteModal.querySelector('#tm-ep-search'); const emoteList = emoteModal.querySelector('#tm-ep-list'); const clearHistoryBtn = panel.querySelector('#tm-ac-clear-history'); const clearHistoryStatus = panel.querySelector('#tm-ac-clear-history-status');
        function openEmotePicker(targetTextarea) {
            currentEmoteTarget = targetTextarea;
            if (getPlatform() === 'kick') collectEmotes();
            emoteModal.classList.add('open');
            emoteSearch.value = '';
            renderEmotePickerList('');
            emoteSearch.focus();
        }
        function renderEmotePickerList(query) {
            emoteList.innerHTML = '';
            const emotes = getPlatform() === 'kick'
                ? Array.from(emoteMap.entries()).filter(([name]) => kickNativeEmoteNames.has(name))
                : Array.from(emoteMap.entries()).filter(([name]) => channelEmoteNames.has(name) || discoveredEmoteNames.has(name) || globalSevenTVEmotes.has(name) || globalTwitchEmotes.has(name));
            const filtered = emotes.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
            if (filtered.length === 0) {
                emoteList.innerHTML = '<div style="color:#adadb8; font-size:13px; padding:20px; width:100%; text-align:center;">' + (getPlatform() === 'kick' ? 'Откройте встроенный пикер Kick или дождитесь появления смайлов в чате.' : 'Смайлы не найдены') + '</div>';
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
        sevenTVRefreshBtn.addEventListener('click', async () => {
            const channelLogin = getChannelInfo().name;
            if (!channelLogin) {
                sevenTVRefreshStatus.textContent = 'Откройте страницу канала Twitch для обновления смайлов.';
                return;
            }
            sevenTVRefreshBtn.disabled = true;
            sevenTVRefreshStatus.textContent = 'Перезапуск загрузчика 7TV...';
            try {
                const count = await refreshSevenTVEmotes(channelLogin);
                if (getChannelInfo().name !== channelLogin) return;
                if (count !== null) {
                    sevenTVRefreshStatus.textContent = count === 0 ? 'У канала нет смайлов 7TV.' : 'Обновлено: ' + count + ' смайлов';
                    renderEmotePickerList(emoteSearch.value);
                }
            } catch {
                if (getChannelInfo().name === channelLogin) sevenTVRefreshStatus.textContent = 'Ошибка перезапуска 7TV. Повторите попытку.';
            } finally {
                sevenTVRefreshBtn.disabled = false;
            }
        });
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
            d.cleanHiddenChars = cleanHiddenCharsCheck.checked;
            delete d.antiSpamRandomizer;
            d.spoilerEnabled = spoilerEnabledCheck.checked;
            d.spoilerNeverReveal = spoilerNeverCheck.checked;
            saveData(d);
            applySpoilerSettings();
            updateSpoilerLock();
            updateLivePreview(msgEl.value, username);
        }
        cleanHiddenCharsCheck.addEventListener('change', saveSettings);
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
                        const d = loadData();
                        const currentHist = getHistory();
                        const normalized = imported.filter(h => h && Array.isArray(h.variants)).map(h => {
                            const entry = { ...h, channel: h.channel ? { ...h.channel, platform: h.channel.platform === 'kick' ? 'kick' : 'twitch' } : { platform: 'twitch', name: 'unknown', displayName: 'Unknown' } };
                            entry.pinnedIn = (entry.pinnedIn || []).map(pin => ['all', 'unknown', 'all-pastes'].includes(pin) || String(pin).includes(':') ? pin : entry.channel.platform + ':' + pin);
                            return entry;
                        });
                        const seen = new Set(currentHist.map(getHistoryIdentity));
                        const additions = normalized.filter(entry => {
                            const identity = getHistoryIdentity(entry);
                            if (seen.has(identity)) return false;
                            seen.add(identity);
                            return true;
                        });
                        d.history = [...additions, ...currentHist];
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
        let clearHistoryHoldTimer = null; let clearHistoryHoldFrame = null; let clearHistoryHoldStart = 0; let clearHistoryHoldDone = false;
        const resetClearHistoryHold = () => {
            if (clearHistoryHoldTimer) { clearTimeout(clearHistoryHoldTimer); clearHistoryHoldTimer = null; }
            if (clearHistoryHoldFrame) { cancelAnimationFrame(clearHistoryHoldFrame); clearHistoryHoldFrame = null; }
            clearHistoryBtn.style.background = '';
            if (!clearHistoryHoldDone) clearHistoryStatus.textContent = 'Удерживайте кнопку 3 секунды. При отпускании раньше история сохранится.';
        };
        clearHistoryBtn.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            resetClearHistoryHold();
            clearHistoryHoldDone = false;
            clearHistoryHoldStart = Date.now();
            try { clearHistoryBtn.setPointerCapture(event.pointerId); } catch {}
            clearHistoryStatus.textContent = 'Не отпускайте кнопку...';
            const updateProgress = () => {
                const progress = Math.min(1, (Date.now() - clearHistoryHoldStart) / 3000);
                clearHistoryBtn.style.background = 'linear-gradient(90deg, #9147ff ' + (progress * 100) + '%, #302023 ' + (progress * 100) + '%)';
                if (progress < 1) clearHistoryHoldFrame = requestAnimationFrame(updateProgress);
            };
            updateProgress();
            clearHistoryHoldTimer = setTimeout(() => {
                clearHistoryHoldDone = true;
                const d = loadData();
                d.history = [];
                saveData(d);
                activeHistoryIdx = -1;
                currentFilter = 'all';
                renderHistory();
                clearHistoryBtn.style.background = '#166b48';
                clearHistoryStatus.textContent = 'История полностью очищена.';
                clearHistoryHoldTimer = null;
            }, 3000);
        });
        clearHistoryBtn.addEventListener('pointerup', resetClearHistoryHold);
        clearHistoryBtn.addEventListener('pointercancel', resetClearHistoryHold);
        clearHistoryBtn.addEventListener('lostpointercapture', resetClearHistoryHold);
        clearHistoryBtn.addEventListener('contextmenu', event => event.preventDefault());
        clearHistoryBtn.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
        let variantCycleSignature = ''; let variantCycleOrder = []; let variantCyclePosition = 0; let variantCycleLast = -1;
        function shuffleVariantIndices(indices) {
            const result = indices.slice();
            for (let i = result.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [result[i], result[j]] = [result[j], result[i]];
            }
            return result;
        }
        function getNextHistoryVariant(variants, historyIndex) {
            const list = (Array.isArray(variants) ? variants : []).map(value => String(value || '').trim()).filter(Boolean);
            if (!list.length) return '';
            const signature = String(historyIndex) + ':' + JSON.stringify(list);
            if (signature !== variantCycleSignature) {
                variantCycleSignature = signature;
                variantCycleOrder = list.length > 1 ? [0, ...shuffleVariantIndices(Array.from({ length: list.length - 1 }, (_, index) => index + 1))] : [0];
                variantCyclePosition = 0;
                variantCycleLast = -1;
            } else if (variantCyclePosition >= variantCycleOrder.length) {
                variantCycleOrder = shuffleVariantIndices(Array.from({ length: list.length }, (_, index) => index));
                if (list.length > 1 && variantCycleOrder[0] === variantCycleLast) {
                    const swapIndex = 1 + Math.floor(Math.random() * (variantCycleOrder.length - 1));
                    [variantCycleOrder[0], variantCycleOrder[swapIndex]] = [variantCycleOrder[swapIndex], variantCycleOrder[0]];
                }
                variantCyclePosition = 0;
            }
            const nextIndex = variantCycleOrder[variantCyclePosition++];
            variantCycleLast = nextIndex;
            return list[nextIndex] || '';
        }
        function addToHistory(variants) {
            if (!variants || variants.length === 0 || !variants[0].trim()) return;
            let hist = getHistory(); const ch = getChannelInfo(); const mainText = variants[0];
            const existingIdx = hist.findIndex(h => h.variants[0] === mainText && h.channel?.name === ch.name && (h.channel?.platform || 'twitch') === ch.platform);
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
                if (!h.channel || !h.channel.name || h.channel.name === 'unknown') return;
                const platform = h.channel.platform === 'kick' ? 'kick' : 'twitch';
                if (h.channel.name === 'all') uniqueChannels.set('all', { ...h.channel, platform, name: 'all' });
                else uniqueChannels.set(getHistoryChannelKey(h.channel), { ...h.channel, platform });
            });
            let optionsHtml = `<div class="tm-ac-hist-filter-item ${currentFilter === 'all' ? 'selected' : ''}" data-val="all">${renderAvatar('', 20)} Все платформы</div>`;
            const hasUnknown = hist.some(h => !h.channel || !h.channel.name || h.channel.name === 'unknown');
            if (hasUnknown) optionsHtml += `<div class="tm-ac-hist-filter-item ${currentFilter === 'unknown' ? 'selected' : ''}" data-val="unknown">${renderAvatar('', 20)} Неизвестные</div>`;
            const hasAll = hist.some(h => h.channel && h.channel.name === 'all');
            if (hasAll) optionsHtml += `<div class="tm-ac-hist-filter-item ${currentFilter === 'all-pastes' ? 'selected' : ''}" data-val="all-pastes">${renderAvatar('', 20)} Везде</div>`;
            Array.from(uniqueChannels.entries()).sort((a, b) => (a[1].displayName || a[1].name).localeCompare(b[1].displayName || b[1].name)).forEach(([key, ch]) => {
                if (ch.name === 'all') return;
                const platform = ch.platform || 'twitch';
                optionsHtml += `<div class="tm-ac-hist-filter-item ${currentFilter === key ? 'selected' : ''}" data-val="${escapeHtml(key)}">${renderAvatar(ch.name, 20, platform)} <span>${getPlatformLabel(platform)} · ${escapeHtml(ch.displayName || ch.name)}</span></div>`;
            });
            filterList.innerHTML = optionsHtml;
            if (currentFilter === 'all') filterText.textContent = 'Все платформы';
            else if (currentFilter === 'unknown') filterText.textContent = 'Неизвестные';
            else if (currentFilter === 'all-pastes') filterText.textContent = 'Везде';
            else {
                const ch = uniqueChannels.get(currentFilter);
                filterText.textContent = ch ? getPlatformLabel(ch.platform || 'twitch') + ' · ' + (ch.displayName || ch.name) : 'Все платформы';
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
            else if (currentFilter !== 'all') filteredHist = indexedHist.filter(h => h.channel && getHistoryChannelKey(h.channel) === currentFilter);
            if (filteredHist.length === 0) {
                historyList.innerHTML = `<div class="tm-ac-hist-empty">Нет паст для этого выбора</div>`;
                return;
            }
            historyList.innerHTML = filteredHist.map((h) => {
                const originalIdx = h.originalIdx;
                const ch = h.channel || { name: "unknown", displayName: "Unknown", platform: "twitch" };
                const platform = ch.platform === 'kick' ? 'kick' : 'twitch';
                const isUnknown = (!ch.name || ch.name === "unknown");
                const isAll = ch.name === "all";
                const displayName = isUnknown ? "Unknown (нажмите чтобы изменить)" : (isAll ? "Везде" : (ch.displayName || ch.name));
                const isPinned = (h.pinnedIn || []).includes(currentFilter);
                const mainText = h.variants[0] || "";
                const variantCount = h.variants.length;
                const variantLabel = variantCount % 10 === 1 && variantCount % 100 !== 11 ? "вариант" : variantCount % 10 >= 2 && variantCount % 10 <= 4 && (variantCount % 100 < 12 || variantCount % 100 > 14) ? "варианта" : "вариантов";
                return `
                    <div class="tm-ac-hist-item ${isPinned ? "pinned" : ""}" data-idx="${originalIdx}" draggable="true">
                        <div class="tm-ac-hist-topline">
                            <div class="tm-ac-hist-channel">
                                ${renderAvatar(ch.name, 16, platform)}
                                <span>${escapeHtml(displayName)}</span>
                                <span style="font-size:9px;font-weight:800;letter-spacing:.45px;padding:2px 5px;border-radius:4px;background:${platform === 'kick' ? 'rgba(83,252,24,.14)' : 'rgba(145,71,255,.18)'};color:${platform === 'kick' ? '#8bff62' : '#bf94ff'};">${getPlatformLabel(platform)}</span>
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
                const idx = +item.dataset.idx; const entry = getHistory()[idx]; const channelEl = item.querySelector('.tm-ac-hist-channel');
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
                                const platform = histNow[idx].channel?.platform === 'kick' ? 'kick' : 'twitch';
                                if (val === 'all' || val === 'везде') histNow[idx].channel = { platform, name: 'all', displayName: 'Везде', avatar: '' };
                                else histNow[idx].channel = { platform, name: val, displayName: val, avatar: getAvatarUrl(val, platform) };
                                const d = loadData();
                                d.history = histNow;
                                saveData(d);
                                renderHistory();
                            } else {
                                channelEl.innerHTML = oldHtml;
                            }
                        };
                        input.addEventListener('input', () => {
                            const q = input.value.trim().toLowerCase(); const platform = getHistory()[idx]?.channel?.platform === 'kick' ? 'kick' : 'twitch'; let html = `<div class="tm-ac-autocomplete-item" data-name="all">${renderAvatar('', 16, platform)} <span>Везде</span></div>`;
                            if (q) {
                                const matches = Array.from(uniqueChannels.values()).filter(c => (c.platform || 'twitch') === platform && (c.name.includes(q) || (c.displayName && c.displayName.toLowerCase().includes(q))));
                                if (matches.length > 0) {
                                    html += matches.map(c => `
                                        <div class="tm-ac-autocomplete-item" data-name="${escapeHtml(c.name)}">
                                            ${renderAvatar(c.name, 16, platform)}
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
                        const nextVariant = getNextHistoryVariant(entry?.variants, idx);
                        if (!nextVariant) return;
                        const result = await sendChatMessage(nextVariant);
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
            if (emoteModal.classList.contains('open')) renderEmotePickerList(emoteSearch.value);
        });
        document.addEventListener('tm-kick-emotes-updated', event => {
            if (getPlatform() !== 'kick') return;
            if (kickEmotesStatus) kickEmotesStatus.textContent = event.detail?.count
                ? 'В списке доступно ' + event.detail.count + ' смайлов Kick.'
                : 'Откройте встроенный пикер Kick или дождитесь смайлов в чате.';
            if (emoteModal.classList.contains('open')) renderEmotePickerList(emoteSearch.value);
        });
        document.addEventListener('tm-kick-chat-settings-updated', () => {
            updateChatStatusUI();
            if (currentTab === 'history') renderHistory();
        });
        document.addEventListener('tm-7tv-emotes-loaded', event => {
            if (!event.detail || event.detail.channel !== getChannelInfo().name) return;
            if (event.detail.count === null) {
                if (event.detail.retrying) {
                    sevenTVRefreshStatus.textContent = 'Сбой 7TV. Повтор ' + event.detail.attempt + '/3 через ' + (event.detail.delay / 1000) + ' с...';
                } else {
                    sevenTVRefreshStatus.textContent = 'Не удалось загрузить 7TV. Нажмите обновить ещё раз.';
                }
            } else {
                sevenTVRefreshStatus.textContent = event.detail.count === 0 ? 'У канала нет смайлов 7TV.' : 'Загружено: ' + event.detail.count + ' смайлов';
            }
        });
        function updateChannelState() {
            const channel = getChannelInfo();
            const currentCh = channel.name;
            const channelKey = getHistoryChannelKey(channel);
            if (channelKey === lastKnownChannel) return;
            lastKnownChannel = channelKey;
            clearChannelSevenTVEmotes(channel.platform === 'twitch' ? currentCh : '');
            if (channel.platform === 'kick') {
                clearKickNativeEmotes();
                if (sevenTVSettingsBlock) sevenTVSettingsBlock.hidden = true;
                if (kickEmotesInfo) kickEmotesInfo.hidden = false;
                if (sevenTVRefreshStatus) sevenTVRefreshStatus.textContent = '7TV для Kick не используется.';
                if (kickEmotesStatus) kickEmotesStatus.textContent = 'Смайлы появятся в списке после загрузки их в чате или встроенном пикере Kick.';
                if (currentCh) loadKickChannelSettings(currentCh);
                collectEmotes();
            } else {
                clearKickNativeEmotes();
                if (sevenTVSettingsBlock) sevenTVSettingsBlock.hidden = false;
                if (kickEmotesInfo) kickEmotesInfo.hidden = true;
                if (currentCh) {
                    if (sevenTVRefreshStatus) sevenTVRefreshStatus.textContent = 'Загрузка смайлов 7TV канала...';
                    fetchSevenTVEmotes(currentCh);
                } else if (sevenTVRefreshStatus) sevenTVRefreshStatus.textContent = 'Откройте страницу канала Twitch для загрузки смайлов.';
            }
            const hist = getHistory();
            if (currentCh && hist.some(h => h.channel && getHistoryChannelKey(h.channel) === channelKey)) currentFilter = channelKey;
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
                const followersOnlyEnabled = getFollowersOnlyInfo();
                followersOnlyStatusEl.hidden = !followersOnlyEnabled;
                if (followersOnlyEnabled) {
                    if (followersOnlyEnabled === 'subscribers') {
                        followersOnlyTitleEl.textContent = 'Чат только для подписчиков';
                        followersOnlyDetailEl.textContent = 'Для отправки сообщений нужна подписка на канал Kick.';
                    } else {
                        followersOnlyTitleEl.textContent = 'Включён чат только для фолловеров';
                        followersOnlyDetailEl.textContent = 'Для отправки сообщений нужно подписаться на канал.';
                    }
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
                        textToSend = getNextHistoryVariant(entry.variants, activeHistoryIdx);
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
        if (!window.__tmAutoChatHistoryHooks) {
            window.__tmAutoChatHistoryHooks = true;
            const refreshChannelAfterNavigation = () => setTimeout(() => { if (refreshChannelState) refreshChannelState(); }, 0);
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            history.pushState = function (...args) {
                const result = originalPushState.apply(this, args);
                refreshChannelAfterNavigation();
                return result;
            };
            history.replaceState = function (...args) {
                const result = originalReplaceState.apply(this, args);
                refreshChannelAfterNavigation();
                return result;
            };
            window.addEventListener('popstate', refreshChannelAfterNavigation);
        }
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
                        if (getPlatform() === 'kick') {
                            return node.matches('img[src*="files.kick.com/emotes/"], span[data-emote-name], img[data-emote-name]') ||
                                !!node.querySelector('img[src*="files.kick.com/emotes/"], span[data-emote-name], img[data-emote-name]');
                        }
                        return node.matches('img.seventv-chat-emote, img[class*="seventv"][alt], img[data-emote-name], img[data-a-target="emote-name"], img.chat-image[alt], img.chat-line__message--emote, img[src*="static-cdn.jtvnw.net/emoticons/v2"][alt]') ||
                            !!node.querySelector('img.seventv-chat-emote, img[class*="seventv"][alt], img[data-emote-name], img[data-a-target="emote-name"], img.chat-image[alt], img.chat-line__message--emote, img[src*="static-cdn.jtvnw.net/emoticons/v2"][alt]');
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