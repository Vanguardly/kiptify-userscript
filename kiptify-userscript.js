// ==UserScript==
// @name         Kiptify | Save & Restore Web Forms
// @namespace    https://github.com/Vanguardly/kiptify
// @version      2.8.0
// @description  Save and restore web forms in a single click.
// @author       Vanguardly
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // -----------------------------------------------------
    // MODULE 1: CONFIGURATION & BRANDING
    // -----------------------------------------------------

    const STORAGE_KEY = 'KiptifyData';
    const SETTINGS_KEY = 'KiptifySettings';
    const FORM_PREFS_KEY = 'KiptifyPrefs';

    const DEFAULT_ICON_POSITION = 'top-right';
    const DEFAULT_RESTORE_DELAY = 50;
    const DEFAULT_ICON_SIZE = 30;

    const KIPTIFY_COLORS = {
        primary: '#df054a',
        primaryDark: '#c80442',
        highlight: '#48b792',
        highlightDark: '#3a9d7b',
        secondary: '#6d5676',
        danger: '#e74c3c',
        dangerDark: '#c0392b',
        warning: '#f1c40f',
        textDark: '#1f2937', // gray-800
        textMedium: '#4b5563', // gray-600
        textLight: '#6b7280', // gray-500
        white: '#FFFFFF',
        offWhite: '#f5f5f5',
        grayLight: '#E5E7EB', // gray-200
    };

    // -----------------------------------------------------
    // MODULE 2: STORAGE ACCESS (No changes)
    // -----------------------------------------------------

    async function getSettings() { return GM_getValue(SETTINGS_KEY, { iconPosition: DEFAULT_ICON_POSITION, restoreDelay: DEFAULT_RESTORE_DELAY, iconSize: DEFAULT_ICON_SIZE }); }
    async function saveSettings(settings) {
        await GM_setValue(SETTINGS_KEY, settings);
        document.querySelectorAll('.kiptify-trigger').forEach(trigger => updateIconPosition(trigger.closest('form')));
    }
    async function getFormPrefs(formId) { const allPrefs = await GM_getValue(FORM_PREFS_KEY, {}); return allPrefs[formId] || { saveHidden: false, listMode: 'blacklist', fieldList: [] }; }
    async function saveFormPrefs(formId, prefs) { const allPrefs = await GM_getValue(FORM_PREFS_KEY, {}); allPrefs[formId] = prefs; await GM_setValue(FORM_PREFS_KEY, allPrefs); }
    async function loadFormStates(identifier) { const allData = await GM_getValue(STORAGE_KEY, {}); return allData[identifier] || []; }
    async function saveFormState(form, identifier, data, customName, delayOverride = 0, restoreHidden = false) {
        const allData = await GM_getValue(STORAGE_KEY, {});
        if (!allData[identifier]) allData[identifier] = [];
        const timestamp = new Date().toLocaleString();
        const newState = { uid: getUniqueId(), name: customName || timestamp, timestamp, delayOverride, restoreHidden, data };
        allData[identifier].unshift(newState);
        allData[identifier] = allData[identifier].slice(0, 20);
        await GM_setValue(STORAGE_KEY, allData);
        return newState;
    }
    async function renameFormState(formId, uid, newName, newDelay, newRestoreHidden) {
        const allData = await GM_getValue(STORAGE_KEY, {});
        if (!allData[formId]) return false;
        const state = allData[formId].find(s => s.uid === uid);
        if (state) {
            state.name = newName;
            if (newDelay !== undefined) state.delayOverride = parseInt(newDelay) || 0;
            if (newRestoreHidden !== undefined) state.restoreHidden = !!newRestoreHidden;
            await GM_setValue(STORAGE_KEY, allData);
            return true;
        }
        return false;
    }
    async function deleteFormState(formId, uid) {
        const allData = await GM_getValue(STORAGE_KEY, {});
        if (!allData[formId]) return false;
        allData[formId] = allData[formId].filter(state => state.uid !== uid);
        if (allData[formId].length === 0) delete allData[formId];
        await GM_setValue(STORAGE_KEY, allData);
        return true;
    }
    async function deleteAllStates() { await GM_setValue(STORAGE_KEY, {}); }
    async function getFlatSavedStates() {
        const allData = await GM_getValue(STORAGE_KEY, {});
        const flatStates = [];
        for (const formId in allData) { allData[formId].forEach(state => flatStates.push({ formId, ...state })); }
        return flatStates;
    }

    // -----------------------------------------------------
    // MODULE 3: DOM UTILITIES & DATA HANDLING (No changes)
    // -----------------------------------------------------

    function getUniqueId() { return Date.now().toString(36) + Math.random().toString(36).substring(2); }
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function getBaseDomain() { try { const parts = new URL(window.location.href).hostname.split('.'); return parts.length > 2 ? parts.slice(-2).join('.') : parts.join('.'); } catch (e) { return 'local-host-or-file'; } }
    function getFormIdentifier(form) { const domain = getBaseDomain(); const formPart = form.id || (form.className.split(' ').find(c => c)) || 'no-id-or-class'; return `${domain}/${formPart}`; }
    function getInputKey(element) { return element.name || element.id; }
    function isElementVisibleAndEditable(element) {
        if (element.type === 'hidden' || element.readOnly || element.disabled) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || (element.offsetWidth === 0 && element.offsetHeight === 0)) return false;
        return true;
    }
    function shouldSaveHiddenField(element, prefs) {
        if (!prefs.saveHidden) return false;
        const identifier = getInputKey(element);
        if (!identifier) return false;
        const fieldList = (prefs.fieldList || []).map(id => id.trim().toLowerCase()).filter(id => id);
        const identifierLower = identifier.toLowerCase();
        const isListed = fieldList.includes(identifierLower);
        if (prefs.listMode === 'whitelist') return isListed;
        if (prefs.listMode === 'blacklist') return !isListed;
        return false;
    }
    async function getFormData(form) {
        const data = {};
        const elements = form.querySelectorAll('input, select, textarea');
        const formId = getFormIdentifier(form);
        const prefs = await getFormPrefs(formId);
        elements.forEach(element => {
            const key = getInputKey(element);
            if (!key || (!isElementVisibleAndEditable(element) && !shouldSaveHiddenField(element, prefs))) return;
            if (element.type === 'checkbox' || element.type === 'radio') data[key] = element.checked;
            else if (element.tagName === 'SELECT') data[key] = element.multiple ? Array.from(element.options).filter(o => o.selected).map(o => o.value) : element.value;
            else data[key] = element.value;
        });
        return data;
    }
    async function applyFormData(formIdentifier, stateData, delayMs) {
        const formIdPart = formIdentifier.split('/')[1];
        const form = document.getElementById(formIdPart) || document.querySelector(`.${formIdPart}`) || document.querySelector('form');
        if (!form) { showToast('Error: Could not find the form to restore.', 'error'); return; }
        let updateCount = 0;
        for (const key in stateData.data) {
            const value = stateData.data[key];
            const elements = form.querySelectorAll(`[name="${key}"], [id="${key}"]`);
            elements.forEach(element => {
                if (element.type === 'checkbox' || element.type === 'radio') element.checked = !!value;
                else if (element.tagName === 'SELECT') {
                    if (element.multiple && Array.isArray(value)) Array.from(element.options).forEach(opt => opt.selected = value.includes(opt.value));
                    else element.value = value;
                } else element.value = value;
                ['input', 'change'].forEach(type => element.dispatchEvent(new Event(type, { bubbles: true })));
                updateCount++;
            });
            if (delayMs > 0) await delay(delayMs);
        }
        showToast(`Restored: ${stateData.name}. ${updateCount} fields updated.`, 'success');
    }

    // -----------------------------------------------------
    // MODULE 4: UI & STYLES
    // -----------------------------------------------------

    function applyStyles() {
        const style = document.createElement('style');
        const color = KIPTIFY_COLORS;
        style.innerHTML = `
            @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@700&family=Nunito:wght@400;600;700&display=swap');
            @import url('https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined');

            /* Kiptify CSS Reset & Scoping */
            #kiptify-app-container {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                pointer-events: none;
                z-index: 999999;
            }
            #kiptify-app-container, #kiptify-app-container *, #kiptify-app-container *::before, #kiptify-app-container *::after {
                all: initial;
                font-family: 'Nunito', sans-serif;
                box-sizing: border-box;
            }

            #kiptify-app-container .font-brand { font-family: 'Ubuntu', sans-serif !important; font-weight: 700; }
            #kiptify-app-container .material-icons, #kiptify-app-container .material-icons-outlined {
                font-family: 'Material Icons' !important; font-weight: normal; font-style: normal; line-height: 1; letter-spacing: normal; text-transform: none;
                display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr; -webkit-font-smoothing: antialiased;
            }
            #kiptify-app-container .material-icons-outlined { font-family: 'Material Icons Outlined' !important; }

            /* Trigger Icon */
            #kiptify-app-container .kiptify-trigger {
                display: flex;
                position: absolute;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                opacity: 0;
                pointer-events: auto;
                background: ${color.primary} !important;
                border: 1px solid rgba(255,255,255,0.7) !important;
                color: ${color.white};
                border-radius: 9999px;
                cursor: pointer;
                transition: all 0.2s ease-in-out !important;
            }
            #kiptify-app-container .kiptify-trigger.kiptify-visible { opacity: 0.8; }
            #kiptify-app-container .kiptify-trigger:hover { filter: brightness(1.1); }

            /* Main Menu */
            #kiptify-app-container .kiptify-menu {
                display: block;
                position: absolute;
                z-index: 10000;
                visibility: hidden;
                min-width: 420px;
                background: #f7f7f7 !important;
                border-radius: 12px !important;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.15) !important;
                padding: 0.5rem;
                color: ${color.textDark};
            }
            #kiptify-app-container .kiptify-menu.kiptify-visible { visibility: visible; }
            #kiptify-app-container .kiptify-menu.pos-top { top: 0; }
            #kiptify-app-container .kiptify-menu.pos-bottom { bottom: 0; }
            #kiptify-app-container .kiptify-menu.pos-left { left: 0; }
            #kiptify-app-container .kiptify-menu.pos-right { right: 0; }
            #kiptify-app-container .kiptify-menu-content { overflow-y: auto; padding: 0.75rem; }

            /* Tab Content */
            #kiptify-app-container .kiptify-tab-content { display: none; }
            #kiptify-app-container .kiptify-tab-content.active { display: block; }


            /* Tabs */
            #kiptify-app-container .kiptify-tab-container {
                display: flex;
                border-bottom: 1px solid ${color.grayLight};
                padding: 0 0.5rem;
            }
            #kiptify-app-container .kiptify-tab-btn {
                display: flex;
                align-items: center;
                background-color: transparent;
                border: none;
                padding: 12px 10px;
                margin-right: 15px;
                color: ${color.secondary};
                font-weight: 600;
                font-size: 0.95rem;
                cursor: pointer;
                transition: all 0.2s ease;
                border-bottom: 3px solid transparent;
                margin-bottom: -1px;
            }
            #kiptify-app-container .kiptify-tab-btn .material-icons-outlined { font-size: 1.25rem; margin-right: 0.5rem; }
            #kiptify-app-container .kiptify-tab-btn.active { color: ${color.primary}; border-bottom-color: ${color.primary}; }
            #kiptify-app-container .kiptify-tab-btn:hover { color: ${color.primary}; }

            /* Entry Rows */
            #kiptify-app-container .kiptify-row {
                display: flex;
                align-items: center;
                background-color: ${color.grayLight};
                border-radius: 8px;
                padding: 0.75rem;
                margin-top: 0.5rem;
                transition: background-color 0.2s ease;
            }
            #kiptify-app-container .kiptify-row:hover { background-color: #d8dbe0; }
            #kiptify-app-container .kiptify-row-main { flex-grow: 1; padding: 0 0.25rem; }
            #kiptify-app-container .kiptify-row-name { font-weight: 700; font-size: 1rem; color: ${color.textDark}; display: flex; align-items: center; }
            #kiptify-app-container .kiptify-row-name .material-icons-outlined { color: ${color.secondary}; margin-left: 0.5rem; font-size: 16px; }
            #kiptify-app-container .kiptify-row-meta { font-size: 0.8rem; color: ${color.textLight}; }
            #kiptify-app-container .kiptify-row-actions { display: flex; align-items: center; gap: 0.5rem; }
            
            /* Action Buttons (in rows) */
            #kiptify-app-container .kiptify-action-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                border: none;
                cursor: pointer;
                color: ${color.white};
                border-radius: 9999px;
                transition: filter 0.2s ease;
            }
            #kiptify-app-container .kiptify-action-btn:hover { filter: brightness(1.1); }

            #kiptify-app-container .kiptify-action-btn.small { width: 30px; height: 30px; }
            #kiptify-app-container .kiptify-action-btn.small .material-icons-outlined { font-size: 16px; }

            #kiptify-app-container .kiptify-action-btn.large { width: 38px; height: 38px; }
            #kiptify-app-container .kiptify-action-btn.large .material-icons-outlined { font-size: 20px; }

            #kiptify-app-container .kiptify-action-btn-restore { background-color: ${color.highlight}; }
            #kiptify-app-container .kiptify-action-btn-edit { background-color: ${color.warning}; }
            #kiptify-app-container .kiptify-action-btn-delete { background-color: ${color.danger}; }

            /* General Buttons & Inputs */
            #kiptify-app-container .kiptify-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                border: none;
                transition: filter 0.2s ease;
                cursor: pointer;
                font-weight: 600;
                border-radius: 0.5rem;
                padding: 0.5rem 1rem;
                color: ${color.white};
            }
            #kiptify-app-container .kiptify-btn:hover { filter: brightness(1.1); }
            #kiptify-app-container .kiptify-btn-primary { background-color: ${color.primary}; }
            #kiptify-app-container .kiptify-btn-secondary { background-color: ${color.grayLight}; color: ${color.textDark}; }
            #kiptify-app-container .kiptify-btn-danger { background-color: ${color.danger}; }
            #kiptify-app-container .kiptify-btn-full-width { width: 100%; margin-top: 1rem; }
            
            #kiptify-app-container .kiptify-input {
                display: block;
                width: 100%;
                padding: 0.5rem 1rem;
                margin-bottom: 0.5rem;
                background-color: rgba(255,255,255,0.5);
                border: 1px solid rgba(0,0,0,0.1);
                border-radius: 0.5rem;
                transition: all 0.2s ease;
                color: ${color.textDark};
                font-size: 1rem;
            }
            #kiptify-app-container .kiptify-input:focus {
                background-color: ${color.white};
                border-color: ${color.primary};
                box-shadow: 0 0 0 3px rgba(223, 5, 74, 0.1);
                outline: none;
            }

            /* Modal */
            #kiptify-app-container .kiptify-modal-overlay {
                display: flex;
                justify-content: center;
                align-items: center;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: auto;
                background-color: rgba(0,0,0,0.4);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                z-index: 100001;
            }
            #kiptify-app-container .kiptify-modal-content {
                background-color: ${color.white}; padding: 1.5rem; border-radius: 0.5rem;
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
                max-width: 450px; width: 90%;
            }
            #kiptify-app-container .kiptify-modal-title {
                font-family: 'Ubuntu', sans-serif !important; font-weight: 700;
                font-size: 1.25rem; color: ${color.textDark}; margin-bottom: 1rem;
            }
            #kiptify-app-container .kiptify-modal-title .kiptify-title-dot { color: ${color.primary}; }
            #kiptify-app-container .kiptify-modal-label {
                display: block; font-weight: 600; font-size: 0.875rem;
                color: ${color.textMedium}; margin-bottom: 0.5rem;
            }
            #kiptify-app-container .kiptify-modal-actions {
                display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;
            }

            /* Toast Notifications */
            #kiptify-app-container .kiptify-toast {
                display: block;
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 100001;
                padding: 12px 22px;
                color: ${color.white};
                font-weight: 600;
                border-radius: 0.5rem;
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
                opacity: 0;
                transition: all 300ms ease;
                pointer-events: none;
            }
            #kiptify-app-container .kiptify-toast.show { opacity: 1; bottom: 30px; }
            #kiptify-app-container .kiptify-toast-success { background-color: ${color.highlight}; }
            #kiptify-app-container .kiptify-toast-error { background-color: ${color.danger}; }
            #kiptify-app-container .kiptify-toast-info { background-color: ${color.secondary}; }

            /* Save Menu Specifics */
            #kiptify-app-container .kiptify-menu-header { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0.5rem; }
            #kiptify-app-container .kiptify-menu-title { font-size: 1.25rem; color: ${color.textDark}; }
            #kiptify-app-container .kiptify-menu-title .kiptify-title-dot { color: ${color.primary}; }
            #kiptify-app-container .kiptify-save-btn-group { display: flex; align-items: center; border-radius: 0.5rem; background-color: ${color.primary}; }
            #kiptify-app-container #kiptify-save-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                padding: 0.5rem 0.75rem 0.5rem 1rem;
                color: ${color.white};
                font-weight: 600;
                background: transparent;
                border: none;
                cursor: pointer;
            }
            #kiptify-app-container #kiptify-save-btn .material-icons { font-size: 18px; }
            #kiptify-app-container #kiptify-save-options-toggle {
                padding: 0.5rem 0.5rem 0.5rem 0.25rem;
                color: ${color.white};
                background: transparent;
                border: none;
                cursor: pointer;
                border-left: 1px solid rgba(255,255,255,0.3);
            }
            #kiptify-app-container .save-accordion { max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; padding: 0 0.5rem; }
            #kiptify-app-container .save-accordion.open { max-height: 100px; }
            #kiptify-app-container .kiptify-save-hidden-label {
                display: flex; align-items: center; font-size: 0.875rem;
                color: ${color.textMedium}; cursor: pointer; padding: 0.5rem 0;
            }
            #kiptify-app-container .kiptify-save-hidden-label input { margin-right: 0.5rem; }
            #kiptify-app-container .kiptify-save-hidden-label .material-icons-outlined { font-size: 16px; margin-right: 0.25rem; }

            /* Settings Tab */
            #kiptify-app-container .kiptify-settings-content { padding: 0.5rem; }
            #kiptify-app-container .kiptify-settings-group { margin-bottom: 1rem; }
            #kiptify-app-container .kiptify-settings-label { display: block; font-weight: 600; font-size: 0.875rem; color: ${color.textMedium}; margin-bottom: 0.5rem; }
            #kiptify-app-container .kiptify-settings-radio-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; font-size: 0.875rem; }
            #kiptify-app-container .kiptify-settings-radio-label { display: flex; align-items: center; cursor: pointer; }
            #kiptify-app-container .kiptify-settings-radio-label input { margin-right: 0.5rem; }
            #kiptify-app-container .kiptify-no-entries-msg { text-align: center; color: ${color.textLight}; font-size: 0.875rem; padding: 2rem 0; }
        `;
        document.head.appendChild(style);
    }

    async function updateIconPosition(form) {
        const iconDiv = form.querySelector('.kiptify-trigger');
        if (!iconDiv) return;
        const settings = await getSettings();
        const size = settings.iconSize || DEFAULT_ICON_SIZE;
        iconDiv.style.width = `${size}px`;
        iconDiv.style.height = `${size}px`;
        iconDiv.style.fontSize = `${size * 0.65}px`;
        iconDiv.style.top = iconDiv.style.right = iconDiv.style.bottom = iconDiv.style.left = '';
        const offset = Math.round(size / 2) - 4;
        switch (settings.iconPosition) {
            case 'top-right':    iconDiv.style.top = `-${offset}px`; iconDiv.style.right = `-${offset}px`; break;
            case 'top-left':     iconDiv.style.top = `-${offset}px`; iconDiv.style.left = `-${offset}px`; break;
            case 'bottom-right': iconDiv.style.bottom = `-${offset}px`; iconDiv.style.right = `-${offset}px`; break;
            case 'bottom-left':  iconDiv.style.bottom = `-${offset}px`; iconDiv.style.left = `-${offset}px`; break;
        }
    }

    function showToast(message, type = 'info') { // Default to 'info'
        const container = document.getElementById('kiptify-app-container');
        let toast = container.querySelector('.kiptify-toast');
        if (toast) toast.remove();

        toast = document.createElement('div');
        toast.className = 'kiptify-toast';
        toast.classList.add(
            type === 'success' ? 'kiptify-toast-success' :
            type === 'error' ? 'kiptify-toast-error' :
            'kiptify-toast-info'
        );
        toast.textContent = message;

        container.appendChild(toast);
        setTimeout(() => { toast.classList.add('show'); }, 50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    function showEditModal(formId, state, updateCallback) {
        const overlay = document.createElement('div');
        overlay.className = 'kiptify-modal-overlay';
        overlay.innerHTML = `
            <div class="kiptify-modal-content">
                <h3 class="kiptify-modal-title">Edit Entry<span class="kiptify-title-dot">.</span></h3>
                <label class="kiptify-modal-label" for="kiptify-edit-name">Entry Name:</label>
                <input type="text" id="kiptify-edit-name" class="kiptify-input" value="${state.name}">
                <div class="kiptify-modal-actions">
                    <button type="button" id="kiptify-edit-cancel" class="kiptify-btn kiptify-btn-secondary">Cancel</button>
                    <button type="button" id="kiptify-edit-save" class="kiptify-btn kiptify-btn-primary">Save</button>
                </div>
            </div>`;
        document.getElementById('kiptify-app-container').appendChild(overlay);

        const content = overlay.querySelector('.kiptify-modal-content');
        content.addEventListener('click', e => e.stopPropagation());
        const closeModal = () => { overlay.remove(); };
        overlay.addEventListener('click', closeModal);
        content.querySelector('#kiptify-edit-cancel').onclick = closeModal;
        content.querySelector('#kiptify-edit-save').onclick = async () => {
            const newName = content.querySelector('#kiptify-edit-name').value.trim();
            if (newName) {
                await renameFormState(formId, state.uid, newName, state.delayOverride, state.restoreHidden);
                showToast('Entry updated!', 'success');
                updateCallback();
                closeModal();
            }
        };
    }

    function createSaveItemRow(state, formId, isGlobal, currentFormId, updateCallback) {
        const item = document.createElement('div');
        item.className = 'kiptify-row';

        const main = document.createElement('div');
        main.className = 'kiptify-row-main';
        main.innerHTML = `<div class="kiptify-row-name">${state.name} ${state.restoreHidden ? '<span class="material-icons-outlined">visibility</span>' : ''}</div><div class="kiptify-row-meta">${isGlobal ? `From: ${formId.split('/')[0]}` : state.timestamp}</div>`;

        const restoreAction = async () => {
             const settings = await getSettings();
             const delayTime = state.delayOverride > 0 ? state.delayOverride : settings.restoreDelay;
             await applyFormData(currentFormId, state, delayTime);
             document.querySelector('.kiptify-menu')?.remove();
        };

        const buttons = document.createElement('div');
        buttons.className = 'kiptify-row-actions';
        const createBtn = (icon, title, colorClass, sizeClass, clickHandler) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `kiptify-action-btn kiptify-action-btn-${colorClass} ${sizeClass}`;
            btn.innerHTML = `<span class="material-icons-outlined">${icon}</span>`;
            btn.title = title;
            btn.onclick = (e) => { e.stopPropagation(); clickHandler(); };
            return btn;
        };

        const restoreIconBtn = createBtn('restore', 'Restore', 'restore', 'large', restoreAction);

        buttons.appendChild(createBtn('edit', 'Edit Name', 'edit', 'small', () => showEditModal(formId, state, updateCallback)));
        buttons.appendChild(createBtn('delete', 'Delete Entry', 'delete', 'small', async () => {
            if (confirm(`Delete "${state.name}"? This cannot be undone.`)) {
                await deleteFormState(formId, state.uid);
                showToast('Entry deleted.', 'info');
                updateCallback();
            }
        }));
        buttons.appendChild(restoreIconBtn);

        item.appendChild(main);
        item.appendChild(buttons);
        return item;
    }

    async function showMenu(form, identifier, triggerElement) {
        document.querySelectorAll('.kiptify-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'kiptify-menu form-container';
        menu.dataset.formId = identifier;
        menu.addEventListener('click', e => e.stopPropagation());

        const appContainer = document.getElementById('kiptify-app-container');
        appContainer.appendChild(menu);

        menu.innerHTML = `
            <div class="kiptify-menu-header">
                <h3 class="font-brand kiptify-menu-title">Kiptify<span class="kiptify-title-dot">.</span></h3>
                <div class="kiptify-save-btn-group">
                    <button type="button" id="kiptify-save-btn">
                        <span class="material-icons">save</span>Save Form
                    </button>
                    <button type="button" id="kiptify-save-options-toggle">
                        <span class="material-icons">expand_more</span>
                    </button>
                </div>
            </div>
            <div id="kiptify-save-accordion" class="save-accordion">
                <label class="kiptify-save-hidden-label">
                    <input type="checkbox" id="kiptify-save-hidden">
                    <span class="material-icons-outlined">visibility</span>
                    Save Hidden Fields
                </label>
            </div>
            <div class="kiptify-tab-container"></div>
            <div class="kiptify-menu-content"></div>`;

        const tabNav = menu.querySelector('.kiptify-tab-container');
        const contentContainer = menu.querySelector('.kiptify-menu-content');
        const settings = await getSettings();

        menu.classList.add('kiptify-visible');
        if (settings.iconPosition.includes('top')) menu.classList.add('pos-top');
        if (settings.iconPosition.includes('bottom')) menu.classList.add('pos-bottom');
        if (settings.iconPosition.includes('left')) menu.classList.add('pos-left');
        if (settings.iconPosition.includes('right')) menu.classList.add('pos-right');

        const menuRect = menu.getBoundingClientRect();
        const availableHeight = window.innerHeight - menuRect.top - 60;
        contentContainer.style.maxHeight = `${availableHeight}px`;

        const updateMenuPosition = () => {
            const formRect = form.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();

            let top = formRect.top;
            let left = formRect.left;

            if (settings.iconPosition.includes('bottom')) {
                top = formRect.bottom - menuRect.height;
            }

            if (settings.iconPosition.includes('right')) {
                left = formRect.right - menuRect.width;
            }

            menu.style.top = `${top}px`;
            menu.style.left = `${left}px`;
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);

        const tabs = { entries: { icon: 'list_alt', title: 'Entries' }, search: { icon: 'search', title: 'Search' }, settings: { icon: 'settings', title: 'Settings' } };

        for(const key in tabs) {
            const tabContent = document.createElement('div');
            tabContent.className = 'kiptify-tab-content';
            tabContent.dataset.tabContent = key;
            tabs[key].content = tabContent;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kiptify-tab-btn';
            btn.dataset.tab = key;
            btn.innerHTML = `<span class="material-icons-outlined">${tabs[key].icon}</span>${tabs[key].title}`;
            btn.onclick = () => switchTab(key);
            tabNav.appendChild(btn);
            contentContainer.appendChild(tabContent);
        }

        const switchTab = (tabName) => {
            for(const key in tabs) {
                tabs[key].content.classList.remove('active');
                tabNav.querySelector(`[data-tab="${key}"]`).classList.remove('active');
            }
            tabs[tabName].content.classList.add('active');
            tabNav.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        };

        const renderEntries = (container, states, isGlobal) => {
            container.innerHTML = '';
            if (states.length === 0) {
                container.innerHTML = `<p class="kiptify-no-entries-msg">${isGlobal ? 'No matches found.' : 'No entries saved yet.'}</p>`;
            } else {
                states.forEach(state => container.appendChild(createSaveItemRow(state, isGlobal ? state.formId : identifier, isGlobal, identifier, renderAll)));
            }
        };

        const renderAll = async () => {
            const localStates = await loadFormStates(identifier);
            renderEntries(tabs.entries.content, localStates, false);
        };

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'kiptify-input';
        searchInput.placeholder = 'Search all...';
        const searchResultsContainer = document.createElement('div');
        searchInput.oninput = async (e) => {
            const query = e.target.value.toLowerCase();
            if (!query) { searchResultsContainer.innerHTML = ''; return; }
            const allStates = await getFlatSavedStates();
            const filtered = allStates.filter(s => s.name.toLowerCase().includes(query) || s.formId.toLowerCase().includes(query));
            renderEntries(searchResultsContainer, filtered, true);
        };
        tabs.search.content.appendChild(searchInput);
        tabs.search.content.appendChild(searchResultsContainer);

        tabs.settings.content.className = 'kiptify-settings-content';
        tabs.settings.content.innerHTML = `
            <div class="kiptify-settings-group">
                <label class="kiptify-settings-label">Icon Position</label>
                <div class="kiptify-settings-radio-grid">
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="top-right">Top Right</label>
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="top-left">Top Left</label>
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="bottom-right">Bottom Right</label>
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="bottom-left">Bottom Left</label>
                </div>
            </div>
            <div class="kiptify-settings-group">
                <label class="kiptify-settings-label" for="kiptify-icon-size">Icon Size (px)</label>
                <input type="number" id="kiptify-icon-size" class="kiptify-input" min="20" max="50" step="2">
            </div>
            <div class="kiptify-settings-group">
                <label class="kiptify-settings-label" for="kiptify-restore-delay">Global Restore Delay (ms)</label>
                <input type="number" id="kiptify-restore-delay" class="kiptify-input" min="0" step="10">
            </div>
            <button type="button" id="kiptify-delete-all" class="kiptify-btn kiptify-btn-danger kiptify-btn-full-width">
                <span class="material-icons">delete_forever</span>Delete All Data
            </button>`;
        getSettings().then(s => {
            tabs.settings.content.querySelector(`input[name="kiptify-pos"][value="${s.iconPosition}"]`).checked = true;
            tabs.settings.content.querySelector('#kiptify-icon-size').value = s.iconSize;
            tabs.settings.content.querySelector('#kiptify-restore-delay').value = s.restoreDelay;
        });
        tabs.settings.content.addEventListener('change', async (e) => {
            const s = await getSettings();
            if (e.target.name === 'kiptify-pos') s.iconPosition = e.target.value;
            if (e.target.id === 'kiptify-icon-size') s.iconSize = parseInt(e.target.value) || DEFAULT_ICON_SIZE;
            if (e.target.id === 'kiptify-restore-delay') s.restoreDelay = parseInt(e.target.value) || 0;
            await saveSettings(s);
            showToast('Settings saved!', 'info');
        });
        tabs.settings.content.querySelector('#kiptify-delete-all').onclick = async () => { if (confirm('!!! WARNING !!!\nThis will delete ALL Kiptify data. This cannot be undone. Are you sure?')) { await deleteAllStates(); showToast('All data has been deleted.', 'error'); menu.remove(); } };

        const saveAccordion = menu.querySelector('#kiptify-save-accordion');
        menu.querySelector('#kiptify-save-options-toggle').onclick = () => saveAccordion.classList.toggle('open');
        const saveHiddenCheckbox = menu.querySelector('#kiptify-save-hidden');
        getFormPrefs(identifier).then(p => saveHiddenCheckbox.checked = p.saveHidden);
        saveHiddenCheckbox.onchange = async (e) => {
            const prefs = await getFormPrefs(identifier);
            prefs.saveHidden = e.target.checked;
            await saveFormPrefs(identifier, prefs);
        };
        menu.querySelector('#kiptify-save-btn').onclick = async () => {
            const prefs = await getFormPrefs(identifier);
            const dataToSave = await getFormData(form);
            await saveFormState(form, identifier, dataToSave, null, 0, prefs.saveHidden);
            renderAll();
            showToast('State saved!', 'success');
        };

        switchTab('entries');
        renderAll();

        const closeMenu = (event) => {
            if (document.querySelector('.kiptify-modal-overlay')) return;
            if (!menu.contains(event.target) && !triggerElement.contains(event.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu, true), 0);
    }

    // -----------------------------------------------------
    // MODULE 6: MAIN EXECUTION
    // -----------------------------------------------------

    function createAppComponent() {
        if (document.getElementById('kiptify-app-container')) return;
        const appContainer = document.createElement('div');
        appContainer.id = 'kiptify-app-container';
        document.body.appendChild(appContainer);
    }

    function attachIcon(form) {
        if (form.querySelector('.kiptify-trigger')) return;
        const iconDiv = document.createElement('div');
        iconDiv.className = 'kiptify-trigger material-icons';
        iconDiv.innerHTML = 'restore';
        iconDiv.title = 'Kiptify: Save/Restore Form';

        iconDiv.addEventListener('click', (e) => {
            e.stopPropagation(); e.preventDefault();
            showMenu(form, getFormIdentifier(form), iconDiv);
        });

        const appContainer = document.getElementById('kiptify-app-container');
        appContainer.appendChild(iconDiv);

        if (window.getComputedStyle(form).position === 'static') {
            form.style.position = 'relative';
        }

        let timeout;
        form.addEventListener('mouseenter', () => { clearTimeout(timeout); iconDiv.classList.add('kiptify-visible'); });
        form.addEventListener('mouseleave', () => { timeout = setTimeout(() => iconDiv.classList.remove('kiptify-visible'), 300); });

        updateIconPosition(form);
    }

    applyStyles();
    createAppComponent();
    document.querySelectorAll('form').forEach(attachIcon);

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if (node.tagName === 'FORM') attachIcon(node);
                    node.querySelectorAll('form').forEach(attachIcon);
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
