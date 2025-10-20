// ==UserScript==
// @name         Kiptify | Save & Restore Web Forms
// @namespace    https://github.com/Vanguardly/kiptify
// @version      3.0.0
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
    async function updateFormState(formId, updatedState) {
        const allData = await GM_getValue(STORAGE_KEY, {});
        if (!allData[formId]) return false;
        const index = allData[formId].findIndex(s => s.uid === updatedState.uid);
        if (index !== -1) {
            allData[formId][index] = updatedState;
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
    function getFieldLabel(element) {
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) return label.textContent.trim();
        }
        const parentLabel = element.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();
        return element.placeholder || '';
    }
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

            const label = getFieldLabel(element);
            let value;

            if (element.type === 'checkbox' || element.type === 'radio') {
                value = element.checked;
            } else if (element.tagName === 'SELECT') {
                value = element.multiple ? Array.from(element.options).filter(o => o.selected).map(o => o.value) : element.value;
            } else {
                value = element.value;
            }
            data[key] = { value, label };
        });
        return data;
    }
    async function getFormStructureData(form, includeHidden) {
        const data = {};
        const elements = form.querySelectorAll('input, select, textarea');
        elements.forEach(element => {
            const key = getInputKey(element);
            if (key) {
                const isVisible = isElementVisibleAndEditable(element);
                if (isVisible || (includeHidden && !isVisible)) {
                    const label = getFieldLabel(element);
                    data[key] = { value: '', label };
                }
            }
        });
        return data;
    }
    async function applyFormData(formIdentifier, stateData, delayMs) {
        const formIdPart = formIdentifier.split('/')[1];
        const form = document.getElementById(formIdPart) || document.querySelector(`.${formIdPart}`) || document.querySelector('form');
        if (!form) { showToast('Error: Could not find the form to restore.', 'error'); return; }
        let updateCount = 0;
        for (const key in stateData.data) {
            const fieldData = stateData.data[key];
            const value = (fieldData && typeof fieldData === 'object' && fieldData.hasOwnProperty('value')) ? fieldData.value : fieldData;
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

            .kiptify-form .font-brand { font-family: 'Ubuntu', sans-serif !important; font-weight: 700; }
            .kiptify-form .material-icons, .kiptify-form .material-icons-outlined {
                font-family: 'Material Icons' !important; font-weight: normal; font-style: normal; line-height: 1; letter-spacing: normal; text-transform: none;
                display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr; -webkit-font-smoothing: antialiased;
            }
            .kiptify-form .material-icons-outlined { font-family: 'Material Icons Outlined' !important; }

            /* Trigger Icon */
            .kiptify-form .kiptify-trigger {
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
            .kiptify-form .kiptify-trigger.kiptify-visible { opacity: 0.8; }
            .kiptify-form .kiptify-trigger:hover { filter: brightness(1.1); }

            /* Main Menu */
            .kiptify-form .kiptify-menu {
                display: block;
                position: absolute;
                z-index: 10000;
                visibility: hidden;
                min-width: 420px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.5)) !important;
                background: rgba(255, 255, 255, 0.5);
                border-radius: 16px;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 1);
                padding: 1rem;
                color: ${color.textDark};
            }
            .kiptify-menu-content { overflow-y: auto; padding: 0.5rem; }

            /* Tabs */
            .kiptify-tab-container { border-bottom: 2px solid rgba(0,0,0,0.05); display: flex; }
            .kiptify-tab-btn {
                background-color: transparent; border: none; padding: 10px 14px; margin-right: 5px;
                border-radius: 8px 8px 0 0; color: ${color.secondary}; font-weight: 700;
                cursor: pointer; transition: all 0.2s ease;
                border-bottom: 2px solid transparent; margin-bottom: -2px;
                display: flex; align-items: center; font-size: 0.875rem;
            }
            .kiptify-tab-btn .material-icons-outlined { font-size: 1.125rem; margin-right: 0.5rem; }
            .kiptify-tab-btn.active { color: ${color.primary}; border-bottom-color: ${color.primary}; }
            .kiptify-tab-btn:hover { color: ${color.primary}; }

            /* Entry Rows */
            .kiptify-row {
                background-color: rgba(255, 255, 255, 0.4); position: relative;
                border-bottom: 1px solid rgba(0,0,0,0.08); transition: background-color 0.2s ease;
                display: flex; align-items: center; padding: 0.25rem; border-radius: 0.5rem;
            }
            .kiptify-row:hover { background-color: rgba(223, 5, 74, 0.05); }
            .kiptify-row-main { flex-grow: 1; padding: 0.25rem; }
            .kiptify-row-name { font-weight: 700; font-size: 0.875rem; color: ${color.textDark}; display: flex; align-items: center; }
            .kiptify-row-name .material-icons-outlined { color: ${color.secondary}; margin-left: 0.5rem; font-size: 16px; }
            .kiptify-row-meta { font-size: 0.7rem; color: ${color.textLight}; text-align: left; }
            .kiptify-row-actions { display: flex; align-items: center; gap: 0.5rem; }
            
            /* Action Buttons (in rows) */
            .kiptify-action-btn {
                border: none; cursor: pointer; color: ${color.white}; border-radius: 9999px;
                display: flex; align-items: center; justify-content: center;
                transition: filter 0.2s ease;
            }
            .kiptify-action-btn:hover { filter: brightness(1.1); }
            .kiptify-action-btn .material-icons-outlined { font-size: 16px; }
            .kiptify-action-btn.small { padding: 0.25rem; }
            .kiptify-action-btn.large { padding: 0.5rem; }
            .kiptify-action-btn.large .material-icons-outlined { font-size: 20px; }
            .kiptify-action-btn-restore { background-color: ${color.highlight}; }
            .kiptify-action-btn-edit { background-color: ${color.warning}; }
            .kiptify-action-btn-download { background-color: ${color.secondary}; }
            .kiptify-action-btn-delete { background-color: ${color.danger}; }

            /* General Buttons & Inputs */
            .kiptify-btn {
                border: none; transition: filter 0.2s ease; cursor: pointer; font-weight: 600;
                border-radius: 0.5rem; padding: 0.5rem 1rem;
                display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
            }
            .kiptify-btn:hover { filter: brightness(1.1); }
            .kiptify-btn-primary { background-color: ${color.primary}; color: ${color.white}; }
            .kiptify-btn-secondary { background-color: ${color.grayLight}; color: ${color.textDark}; }
            .kiptify-btn-danger { background-color: ${color.danger}; color: ${color.white}; }
            .kiptify-btn-full-width { width: 100%; margin-top: 1rem; }
            
            .kiptify-input {
                background-color: rgba(255,255,255,0.5); border: 1px solid rgba(0,0,0,0.1); transition: all 0.2s ease;
                width: 100%; padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 0.5rem;
            }
            .kiptify-input:focus {
                background-color: ${color.white}; border-color: ${color.primary};
                box-shadow: 0 0 0 3px rgba(223, 5, 74, 0.1); outline: none;
            }

            /* Modal */
            .kiptify-modal-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto;
                background: rgba(255, 255, 255, 0.5);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                z-index: 100001; display: flex; justify-content: center; align-items: center;
            }
            .kiptify-modal-content {
                background-color: ${color.white}; padding: 1.5rem; border-radius: 0.5rem;
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
                max-width: 450px; width: 90%;
            }
            .kiptify-modal-title {
                font-family: 'Ubuntu', sans-serif !important; font-weight: 700;
                font-size: 1.25rem; color: ${color.textDark}; margin-bottom: 1rem;
            }
            .kiptify-modal-title .kiptify-title-dot { color: ${color.primary}; }
            .kiptify-modal-label {
                display: block; font-weight: 600; font-size: 0.875rem;
                color: ${color.textMedium}; margin-bottom: 0.5rem;
            }
            .kiptify-modal-actions {
                display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;
            }

            /* Toast Notifications */
            .kiptify-toast {
                position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                z-index: 100001; padding: 12px 22px; color: ${color.white}; font-weight: 600;
                border-radius: 0.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
                opacity: 0; transition: all 300ms ease; pointer-events: none;
            }
            .kiptify-toast.show { opacity: 1; bottom: 30px; }
            .kiptify-toast-success { background-color: ${color.highlight}; }
            .kiptify-toast-error { background-color: ${color.danger}; }
            .kiptify-toast-info { background-color: ${color.secondary}; }

            /* Save Menu Specifics */
            .kiptify-menu-header { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0.5rem; }
            .kiptify-menu-title { font-size: 26px; font-weight: bold; color: ${color.textDark}; }
            .kiptify-menu-title .kiptify-title-dot { color: ${color.primary}; }
            .kiptify-save-btn-group { display: flex; align-items: center; border-radius: 0.5rem; background-color: ${color.primary}; }
            #kiptify-save-btn {
                display: flex; align-items: center; justify-content: center; gap: 0.5rem;
                padding: 0.5rem 0.75rem 0.5rem 1rem; color: ${color.white}; font-weight: 600;
                background: transparent; border: none; cursor: pointer;
            }
            #kiptify-save-btn .material-icons { font-size: 18px; }
            #kiptify-save-options-toggle {
                padding: 0.5rem 0.5rem 0.5rem 0.25rem; color: ${color.white};
                background: transparent; border: none; cursor: pointer;
                border-left: 1px solid rgba(255,255,255,0.3);
            }
            .save-accordion { max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; padding: 0 0.5rem; }
            .save-accordion.open { max-height: 100px; }
            .kiptify-save-hidden-label {
                display: flex; align-items: center; font-size: 0.875rem;
                color: ${color.textMedium}; cursor: pointer; padding: 0.5rem 0;
            }
            .kiptify-save-hidden-label input { margin-right: 0.5rem; }
            .kiptify-save-hidden-label .material-icons-outlined { font-size: 16px; margin-right: 0.25rem; }

            /* Settings Tab */
            .kiptify-settings-content { padding: 1rem; }
            .kiptify-settings-group {
                background: rgba(255, 255, 255, 0.5);
                border-radius: 8px;
                padding: 1rem;
                margin-bottom: 1rem;
                border: 1px solid rgba(255, 255, 255, 0.8);
            }
            .kiptify-settings-label {
                display: block;
                font-weight: 700;
                font-size: 0.875rem;
                color: ${color.textDark};
                margin-bottom: 0.75rem;
                display: flex;
                align-items: center;
            }
            .kiptify-settings-label .material-icons-outlined {
                margin-right: 0.5rem;
                color: ${color.secondary};
            }
            .kiptify-settings-radio-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.75rem;
                font-size: 0.875rem;
            }
            .kiptify-settings-radio-label {
                background: rgba(255, 255, 255, 0.7);
                padding: 0.75rem;
                border-radius: 6px;
                display: flex;
                align-items: center;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 1px solid transparent;
            }
            .kiptify-settings-radio-label:hover {
                background: rgba(255, 255, 255, 1);
                border-color: ${color.highlight};
            }
            .kiptify-settings-radio-label input { margin-right: 0.5rem; }
            .kiptify-no-entries-msg { text-align: center; color: ${color.textLight}; font-size: 0.875rem; padding: 2rem 0; }
            .kiptify-hidden-field { opacity: 0.6; }
            .kiptify-hidden-field .kiptify-input { background-color: #f0f0f0; }
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
        let toast = document.querySelector('.kiptify-toast');
        if (toast) toast.remove();

        toast = document.createElement('div');
        toast.className = 'kiptify-toast';
        toast.classList.add(
            type === 'success' ? 'kiptify-toast-success' :
            type === 'error' ? 'kiptify-toast-error' :
            'kiptify-toast-info'
        );
        toast.textContent = message;

        document.body.appendChild(toast);
        setTimeout(() => { toast.classList.add('show'); }, 50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }


    function showAddCustomModal(formId, form, updateCallback) {
        const overlay = document.createElement('div');
        overlay.className = 'kiptify-modal-overlay';
        overlay.innerHTML = `
            <div class="kiptify-modal-content" style="max-width: 400px;">
                <h3 class="kiptify-modal-title">Add Custom Entry<span class="kiptify-title-dot">.</span></h3>
                <p style="color: #6b7280; font-size: 0.875rem; margin-bottom: 1rem;">
                    Choose an option to create a new, editable entry for this form.
                </p>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    <button type="button" id="kiptify-create-blank" class="kiptify-btn kiptify-btn-secondary">
                        <span class="material-icons-outlined">add_box</span>Create Blank Entry
                    </button>
                    <div style="border: 1px solid #E5E7EB; border-radius: 0.5rem; padding: 0.75rem;">
                        <button type="button" id="kiptify-create-from-form" class="kiptify-btn kiptify-btn-secondary" style="width: 100%;">
                            <span class="material-icons-outlined">post_add</span>Create From Current Form
                        </button>
                        <label class="kiptify-save-hidden-label" style="margin-top: 0.75rem; justify-content: center;">
                            <input type="checkbox" id="kiptify-include-hidden">
                            <span class="material-icons-outlined">visibility_off</span>
                            Include Hidden Fields
                        </label>
                    </div>
                </div>
                <div class="kiptify-modal-actions" style="margin-top: 1.5rem;">
                    <button type="button" id="kiptify-custom-cancel" class="kiptify-btn kiptify-btn-secondary">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const content = overlay.querySelector('.kiptify-modal-content');
        const closeModal = () => overlay.remove();
        overlay.addEventListener('click', closeModal);
        content.querySelector('#kiptify-custom-cancel').onclick = closeModal;
        content.addEventListener('click', e => e.stopPropagation());

        content.querySelector('#kiptify-create-blank').onclick = async () => {
            const newState = await saveFormState(form, formId, {}, "New Custom Entry");
            closeModal();
            showAdvancedEditModal(formId, newState, form, updateCallback);
        };

        content.querySelector('#kiptify-create-from-form').onclick = async () => {
            const includeHidden = content.querySelector('#kiptify-include-hidden').checked;
            const data = await getFormStructureData(form, includeHidden);
            const newState = await saveFormState(form, formId, data, "New From Form");
            closeModal();
            showAdvancedEditModal(formId, newState, form, updateCallback);
        };
    }

    function showAdvancedEditModal(formId, state, form, updateCallback) {
        const overlay = document.createElement('div');
        overlay.className = 'kiptify-modal-overlay';
        overlay.innerHTML = `
            <div class="kiptify-modal-content" style="max-width: 600px; max-height: 80vh; display: flex; flex-direction: column;">
                <h3 class="kiptify-modal-title">Edit Entry<span class="kiptify-title-dot">.</span></h3>
                <div id="kiptify-edit-fields-container" style="flex-grow: 1; overflow-y: auto; padding-right: 1rem;">
                    <!-- Fields will be rendered here -->
                </div>
                <div class="kiptify-modal-actions">
                    <button type="button" id="kiptify-edit-cancel" class="kiptify-btn kiptify-btn-secondary">Close</button>
                    <button type="button" id="kiptify-edit-save" class="kiptify-btn kiptify-btn-primary">Save Changes</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const content = overlay.querySelector('.kiptify-modal-content');
        content.addEventListener('click', e => e.stopPropagation());
        const closeModal = () => overlay.remove();
        overlay.addEventListener('click', closeModal);
        content.querySelector('#kiptify-edit-cancel').onclick = closeModal;

        const fieldsContainer = content.querySelector('#kiptify-edit-fields-container');

        const renderFields = (data) => {
            fieldsContainer.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 0.5rem 1rem; align-items: center; margin-bottom: 1rem;">
                    <label class="kiptify-modal-label" for="kiptify-edit-name" style="margin: 0;">Entry Name:</label>
                    <input type="text" id="kiptify-edit-name" class="kiptify-input" value="${state.name}" style="margin: 0;">
                </div>
                <hr style="border: none; border-top: 1px solid #eee; margin: 1rem 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <h4 style="font-weight: 600; color: #4b5563; margin: 0;">Fields</h4>
                    <button type="button" id="kiptify-add-field" class="kiptify-btn kiptify-btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                        <span class="material-icons-outlined" style="font-size: 1rem; margin-right: 0.25rem;">add</span>Add Field
                    </button>
                </div>`;

            const formElements = Array.from(form.querySelectorAll('input, select, textarea'));

            for (const key in data) {
                const fieldData = data[key];
                const isOldFormat = typeof fieldData !== 'object' || !fieldData.hasOwnProperty('value');
                const value = isOldFormat ? fieldData : fieldData.value;
                const label = isOldFormat ? '' : fieldData.label;

                const fieldRow = document.createElement('div');
                fieldRow.className = 'kiptify-edit-field-row';

                const correspondingElement = formElements.find(el => getInputKey(el) === key);
                if (correspondingElement && !isElementVisibleAndEditable(correspondingElement)) {
                    fieldRow.classList.add('kiptify-hidden-field');
                    fieldRow.title = 'This is a hidden field.';
                }

                fieldRow.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr 1fr 50px; gap: 0.5rem 1rem; align-items: center; margin-bottom: 0.5rem;';
                fieldRow.innerHTML = `
                    <input type="text" class="kiptify-input kiptify-edit-label" value="${label}" placeholder="Label" style="margin: 0;">
                    <input type="text" class="kiptify-input kiptify-edit-key" value="${key}" placeholder="Field Name" style="margin: 0;">
                    <input type="text" class="kiptify-input kiptify-edit-value" value="${value}" placeholder="Field Value" style="margin: 0;">
                    <button type="button" class="kiptify-action-btn kiptify-action-btn-delete small" title="Delete Field">
                        <span class="material-icons-outlined">delete</span>
                    </button>`;
                fieldsContainer.appendChild(fieldRow);

                fieldRow.querySelector('.kiptify-action-btn-delete').addEventListener('click', () => {
                    fieldRow.remove();
                });
            }
        };

        renderFields(state.data);

        fieldsContainer.querySelector('#kiptify-add-field').addEventListener('click', () => {
            const newFieldRow = document.createElement('div');
            newFieldRow.className = 'kiptify-edit-field-row';
            newFieldRow.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr 1fr 50px; gap: 0.5rem 1rem; align-items: center; margin-bottom: 0.5rem;';
            newFieldRow.innerHTML = `
                <input type="text" class="kiptify-input kiptify-edit-label" placeholder="Label" style="margin: 0;">
                <input type="text" class="kiptify-input kiptify-edit-key" placeholder="Field Name" style="margin: 0;">
                <input type="text" class="kiptify-input kiptify-edit-value" placeholder="Field Value" style="margin: 0;">
                <button type="button" class="kiptify-action-btn kiptify-action-btn-delete small" title="Delete Field">
                    <span class="material-icons-outlined">delete</span>
                </button>`;
            fieldsContainer.appendChild(newFieldRow);

            newFieldRow.querySelector('.kiptify-action-btn-delete').addEventListener('click', () => {
                newFieldRow.remove();
            });
        });

        content.querySelector('#kiptify-edit-save').onclick = async () => {
            const newName = content.querySelector('#kiptify-edit-name').value.trim();
            if (!newName) {
                showToast('Entry name cannot be empty.', 'error');
                return;
            }

            const newData = {};
            const fieldRows = fieldsContainer.querySelectorAll('.kiptify-edit-field-row');
            let hasError = false;
            fieldRows.forEach(row => {
                const key = row.querySelector('.kiptify-edit-key').value.trim();
                const value = row.querySelector('.kiptify-edit-value').value;
                const label = row.querySelector('.kiptify-edit-label').value.trim();
                if (key) {
                    if (newData.hasOwnProperty(key)) {
                        showToast(`Duplicate field name: ${key}`, 'error');
                        hasError = true;
                    }
                    newData[key] = { value, label };
                }
            });

            if (hasError) return;

            const updatedState = { ...state, name: newName, data: newData };

            await updateFormState(formId, updatedState);
            showToast('Entry updated!', 'success');
            updateCallback();
            closeModal();
        };
    }

    function createSaveItemRow(state, formId, isGlobal, currentFormId, form, updateCallback) {
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

        buttons.appendChild(createBtn('edit', 'Edit', 'edit', 'small', () => showAdvancedEditModal(formId, state, form, updateCallback)));
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
        menu.className = 'kiptify-menu';
        menu.style.cssText = `position: absolute; z-index: 10000; visibility: hidden;`;
        menu.addEventListener('click', e => e.stopPropagation());
        form.appendChild(menu);

        menu.innerHTML = `
            <div class="kiptify-menu-header">
                <h3 class="font-brand kiptify-menu-title">Kiptify<span class="kiptify-title-dot">.</span></h3>
                <div style="display: flex; gap: 0.5rem;">
                    <button type="button" id="kiptify-add-custom-btn" class="kiptify-btn kiptify-btn-secondary" style="padding: 0.5rem 0.75rem;">
                        <span class="material-icons-outlined" style="font-size: 1.125rem;">add</span>
                    </button>
                    <div class="kiptify-save-btn-group">
                        <button type="button" id="kiptify-save-btn">
                            <span class="material-icons">save</span>Save Form
                        </button>
                        <button type="button" id="kiptify-save-options-toggle">
                            <span class="material-icons">expand_more</span>
                        </button>
                    </div>
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

        // Position menu next to the trigger icon
        const iconRect = triggerElement.getBoundingClientRect();
        const formRect = form.getBoundingClientRect();
        const spacing = 5; // 5px space between icon and menu

        if (settings.iconPosition.includes('top')) {
            menu.style.top = `${iconRect.bottom - formRect.top + spacing}px`;
        } else { // bottom
            menu.style.bottom = `${formRect.bottom - iconRect.top + spacing}px`;
        }

        if (settings.iconPosition.includes('left')) {
            menu.style.left = `${iconRect.left - formRect.left}px`;
        } else { // right
            menu.style.right = `${formRect.right - iconRect.right}px`;
        }

        menu.style.visibility = 'visible';

        const menuRect = menu.getBoundingClientRect();
        const availableHeight = window.innerHeight - menuRect.top - 60;
        contentContainer.style.maxHeight = `${availableHeight}px`;

        const tabs = { entries: { icon: 'list_alt', title: 'Entries' }, search: { icon: 'search', title: 'Search' }, settings: { icon: 'settings', title: 'Settings' } };

        for(const key in tabs) {
            tabs[key].content = document.createElement('div');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kiptify-tab-btn';
            btn.dataset.tab = key;
            btn.innerHTML = `<span class="material-icons-outlined">${tabs[key].icon}</span>${tabs[key].title}`;
            btn.onclick = () => switchTab(key);
            tabNav.appendChild(btn);
            contentContainer.appendChild(tabs[key].content);
        }

        const switchTab = (tabName) => {
            for(const key in tabs) {
                tabs[key].content.style.display = 'none';
                tabNav.querySelector(`[data-tab="${key}"]`).classList.remove('active');
            }
            tabs[tabName].content.style.display = 'block';
            tabNav.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        };

        const renderEntries = (container, states, isGlobal) => {
            container.innerHTML = '';
            if (states.length === 0) {
                container.innerHTML = `<p class="kiptify-no-entries-msg">${isGlobal ? 'No matches found.' : 'No entries saved yet.'}</p>`;
            } else {
                states.forEach(state => container.appendChild(createSaveItemRow(state, isGlobal ? state.formId : identifier, isGlobal, identifier, form, renderAll)));
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
                <label class="kiptify-settings-label">
                    <span class="material-icons-outlined">control_camera</span>
                    Icon Position
                </label>
                <div class="kiptify-settings-radio-grid">
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="top-right">Top Right</label>
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="top-left">Top Left</label>
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="bottom-right">Bottom Right</label>
                    <label class="kiptify-settings-radio-label"><input type="radio" name="kiptify-pos" value="bottom-left">Bottom Left</label>
                </div>
            </div>
            <div class="kiptify-settings-group">
                <label class="kiptify-settings-label" for="kiptify-icon-size">
                    <span class="material-icons-outlined">photo_size_select_small</span>
                    Icon Size (px)
                </label>
                <input type="number" id="kiptify-icon-size" class="kiptify-input" min="20" max="50" step="2">
            </div>
            <div class="kiptify-settings-group">
                <label class="kiptify-settings-label" for="kiptify-restore-delay">
                    <span class="material-icons-outlined">timer</span>
                    Global Restore Delay (ms)
                </label>
                <input type="number" id="kiptify-restore-delay" class="kiptify-input" min="0" step="10">
            </div>
            <div class="kiptify-settings-group">
                <label class="kiptify-settings-label">
                    <span class="material-icons-outlined">dangerous</span>
                    Danger Zone
                </label>
                <button type="button" id="kiptify-delete-all" class="kiptify-btn kiptify-btn-danger kiptify-btn-full-width">
                    <span class="material-icons">delete_forever</span>Delete All Data
                </button>
            </div>`;
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

        menu.querySelector('#kiptify-add-custom-btn').onclick = () => {
            showAddCustomModal(identifier, form, renderAll);
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

    function attachIcon(form) {
        if (form.querySelector('.kiptify-trigger')) return;
        form.classList.add('kiptify-form');
        const iconDiv = document.createElement('div');
        iconDiv.className = 'kiptify-trigger material-icons';
        iconDiv.textContent = 'restore';
        iconDiv.title = 'Kiptify: Save/Restore Form';

        iconDiv.addEventListener('click', (e) => {
            e.stopPropagation(); e.preventDefault();
            showMenu(form, getFormIdentifier(form), iconDiv);
        });

        if (window.getComputedStyle(form).position === 'static') {
            form.style.position = 'relative';
        }

        let timeout;
        form.addEventListener('mouseenter', () => {
            clearTimeout(timeout);
            iconDiv.classList.add('kiptify-visible');
        });
        form.addEventListener('mouseleave', () => {
            timeout = setTimeout(() => {
                iconDiv.classList.remove('kiptify-visible');
            }, 300);
        });

        form.appendChild(iconDiv);
        updateIconPosition(form);
    }

    applyStyles();
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
