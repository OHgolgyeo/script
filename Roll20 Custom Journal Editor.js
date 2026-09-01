// ==UserScript==
// @name         Roll20 Custom Journal Editor
// @namespace    http://tampermonkey.net/
// @version      1.0
// @author       오골계 (https://x.com/5golgyeo)
// @description  지원 기능: 본문 이미지 첨부, 글자 크기 지정, 색상 선택 기능 추가, 표 너비·높이·정렬 변경, 표 칸 배경색·테두리 지정, 표 칸 합치기·나누기, 가름줄(구분선) 색상·두께·모양 변경, 템플릿 저장·불러오기, 구글 문서 붙여넣을 시 깨지는 오류 수정, 핸드아웃/캐릭터/라이브러리 이미지 다중 선택(Ctrl+클릭, Ctrl+Shift+클릭 범위 선택) 후 우클릭으로 일괄 삭제)
// @grant        none
// @updateURL    https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Custom%20Journal%20Editor.js
// @downloadURL  https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Custom%20Journal%20Editor.js
// ==/UserScript==

(function() {
    'use strict';

    console.log('[R20-Custom-Editor] 스크립트 실행 시작, 버전 2.3 (Free)');

    /* [ 글자 크기 설정 영역 ] */
    const DEFAULT_CUSTOM_FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72];
    const R20_FONT_SIZES_STORAGE_KEY = 'r20CustomEditor_customFontSizes';

    const r20LoadFromStorage = (key, defaults) => {
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {
            console.warn('[R20-Custom-Editor] 저장된 설정을 불러오지 못해 기본값을 사용합니다.', e);
        }
        try {
            localStorage.setItem(key, JSON.stringify(defaults));
        } catch (e) {
            console.warn('[R20-Custom-Editor] 설정을 저장하지 못했습니다.', e);
        }
        return defaults;
    };

    let CUSTOM_FONT_SIZES = r20LoadFromStorage(R20_FONT_SIZES_STORAGE_KEY, DEFAULT_CUSTOM_FONT_SIZES);

    window.r20CustomEditorSetFontSizes = function(sizes) {
        if (!Array.isArray(sizes) || sizes.length === 0) {
            console.error('[R20-Custom-Editor] sizes는 비어있지 않은 배열이어야 합니다.');
            return;
        }
        localStorage.setItem(R20_FONT_SIZES_STORAGE_KEY, JSON.stringify(sizes));
        console.log('[R20-Custom-Editor] 글자 크기 목록이 저장되었습니다. 페이지를 새로고침하세요.');
    };

    window.r20CustomEditorResetFontSizes = function() {
        localStorage.removeItem(R20_FONT_SIZES_STORAGE_KEY);
        console.log('[R20-Custom-Editor] 글자 크기 설정이 기본값으로 초기화되었습니다. 페이지를 새로고침하세요.');
    };

    const R20_HANDOUT_AVATAR_HIDE_CSS = `
            .handoutviewer .avatar,
            .handoutviewer img.avatar {
                display: none !important;
                height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
            }`;

    if (!document.getElementById('r20-custom-style-v30')) {
        const style = document.createElement('style');
        style.id = 'r20-custom-style-v30';
        style.innerHTML = `
            ${R20_HANDOUT_AVATAR_HIDE_CSS}

            .note-editable table {
                table-layout: fixed !important;
            }
            .note-editable td, .note-editable th {
                position: relative;
                word-break: break-all;
            }
            .r20-table-cell-selected {
                box-shadow: inset 0 0 0 999px rgba(51, 122, 255, 0.28) !important;
            }
            .note-editable p,
            .handoutviewer p {
                display: block !important;
            }

            .namecontainer.r20-journal-selected-name,
            .nj-name.r20-journal-selected-name {
                color: #e53935 !important;
                font-weight: 600 !important;
            }

            .r20-real-preview-label {
                font-weight: bold !important;
                font-size: 13px !important;
                color: #333333 !important;
                margin-top: 12px !important;
                margin-bottom: 6px !important;
                display: block !important;
                text-align: left !important;
                width: 100% !important;
                clear: both !important;
            }

            .dropdown-menu .note-palette {
                display: inline-block !important;
                vertical-align: top !important;
                width: 200px !important;
                box-sizing: border-box !important;
            }

            .dropdown-menu .note-palette .note-color-reset {
                display: block !important;
                width: calc(100% - 20px) !important;
                max-width: calc(100% - 20px) !important;
                box-sizing: border-box !important;
                white-space: normal !important;
                font-size: 11px !important;
                line-height: 1.2 !important;
                padding: 1px 2px !important;
                text-align: center !important;
                margin: 0 auto !important;
            }

            .custom-color-picker-wrapper {
                max-width: 400px !important;
                box-sizing: border-box !important;
            }

            .custom-color-picker-wrapper .ccpw-control {
                height: 24px !important;
                min-height: 24px !important;
                max-height: 24px !important;
                box-sizing: border-box !important;
                font-size: 11px !important;
                margin: 0 !important;
            }
            .custom-color-picker-wrapper .ccpw-label {
                display: inline-flex !important;
                align-items: flex-end !important;
                height: 24px !important;
                min-height: 24px !important;
                max-height: 24px !important;
                box-sizing: border-box !important;
                font-size: 11px !important;
                color: #333333 !important;
                white-space: nowrap !important;
                margin: 0 !important;
                padding-bottom: 2px !important;
            }
        `;
        document.head.appendChild(style);
    }

    /* [ 공통 유틸 - 선택영역(커서) 저장/복원 ] */
    let savedRange = null;
    let savedEditor = null;

    const getEditorFromNode = (node) => {
        if (!node) return null;
        const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!element || !element.closest) return null;
        return element.closest('.note-editable, .tox-edit-area') || null;
    };

    const notifyEditorContentChanged = (editor) => {
        if (!editor) return;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatSetBlockTextDirection' }));
    };

    const saveSelection = () => {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const editor = getEditorFromNode(range.commonAncestorContainer);
        if (!editor) return;

        savedRange = range.cloneRange();
        savedEditor = editor;
    };

    const restoreSelection = () => {
        const selection = window.getSelection();
        if (!selection) return false;

        if (!savedRange || (savedEditor && !savedEditor.isConnected)) {
            savedRange = null;
            savedEditor = null;

            if (selection.rangeCount > 0) {
                const liveRange = selection.getRangeAt(0);
                const liveEditor = getEditorFromNode(liveRange.commonAncestorContainer);
                if (liveEditor) return true;
            }
            return false;
        }

        selection.removeAllRanges();
        selection.addRange(savedRange);
        return true;
    };

    /* [ 공통 유틸 - 팝업 바깥 클릭하면 닫기 ] */
    const attachOutsideClickClose = (el, anchorBtn) => {
        const closeFn = () => {
            el.remove();
            document.removeEventListener('click', handler, true);
        };
        const handler = (ev) => {
            if (!el.contains(ev.target) && ev.target !== anchorBtn) closeFn();
        };
        el._r20CloseOnOutsideClick = handler;
        setTimeout(() => document.addEventListener('click', handler, true), 0);
        return closeFn;
    };

    /* [ 공통 유틸 - 커스텀 팝업 "한번 더 누르면 닫힘" 토글 ] */
    const toggleCustomPopover = (popoverId, openFn) => {
        const existing = document.getElementById(popoverId);
        if (existing) {
            if (typeof existing._r20CloseOnOutsideClick === 'function') {
                document.removeEventListener('click', existing._r20CloseOnOutsideClick, true);
            }
            existing.remove();
            return;
        }
        openFn();
    };

    /* [ 가름줄(<hr>) 선택 상태 추적 ] */
    let selectedHrEl = null;

    document.addEventListener('click', (e) => {
        const editor = e.target.closest && e.target.closest('.note-editable');
        if (!editor) return;

        if (e.target.tagName === 'HR') {
            if (selectedHrEl && selectedHrEl !== e.target) selectedHrEl.style.outline = '';
            selectedHrEl = e.target;
            selectedHrEl.style.outline = '2px solid #4a90d9';
            selectedHrEl.style.outlineOffset = '2px';
        } else if (selectedHrEl) {
            selectedHrEl.style.outline = '';
            selectedHrEl = null;
        }
    }, true);

    /* [ 핸드아웃 뷰어 스타일 서버 동기화 - Roll20 브라우저 저장이 <style> 등을
         걸러내는 문제를 우회하기 위해, 스크립트가 없는 다른 사람에게도(예:
         아바타 숨기기) 그대로 보이도록 별도의 Roll20 API 스크립트
         ("R20FontSync")로 채팅을 통해 전달한다. API 스크립트는 handout.set()으로
         직접 저장하므로 브라우저 저장 시의 필터링을 거치지 않는다.
         (동봉된 "R20FontSync.js"를 캠페인 설정 > API Scripts에 설치해야 동작함.
         GM 권한으로 채팅을 보낼 수 있어야 하므로 GM만 동작함)
         base64로 인코딩해서 보낸다. Roll20 채팅에는 글자수 제한이 없다고
         확인받았으므로 기본적으로 한 메시지에 다 넣어서 보내고, 혹시라도
         비정상적으로 거대한 핸드아웃이 있을 경우를 대비한 안전장치로만
         나눠 보내는 기능을 남겨둔다(사실상 거의 항상 1개 메시지로 끝난다). ] */
    const R20_CHAT_TEXTAREA_SELECTOR = 'textarea[title="Text Chat Input"]';

    const R20_FONT_SYNC_CHUNK_SIZE = 200000;
    const R20_FONT_SYNC_WORD_BREAK_INTERVAL = 40;
    const R20_FONT_SYNC_CHUNK_DELAY_MS = 350;

    const insertWordBreaks = (str, interval) => {
        const parts = [];
        for (let i = 0; i < str.length; i += interval) {
            parts.push(str.slice(i, i + interval));
        }
        return parts.join(' ');
    };

    const buildEmbeddedStyleBlock = () => {
        return '<style>' + R20_HANDOUT_AVATAR_HIDE_CSS + '</style>';
    };

    const R20_CHAT_TAB_ID = 'textchattab';

    const clickR20Tab = (tabId) => {
        const tab = document.getElementById(tabId);
        if (!tab) return false;
        (tab.querySelector('a') || tab).click();
        return true;
    };

    const getActiveR20TabId = () => {
        const activeTab = document.querySelector('.tabmenu.ui-tabs-nav > li.ui-tabs-active, .tabmenu.ui-tabs-nav > li.ui-state-active');
        return activeTab ? activeTab.id : null;
    };

    const sendR20ChatMessage = (text) => new Promise((resolve) => {
        const textarea = document.querySelector(R20_CHAT_TEXTAREA_SELECTOR);
        if (!textarea) { resolve(false); return; }

        const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeValueSetter.call(textarea, text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();

        setTimeout(() => {
            if (document.activeElement !== textarea) textarea.focus();

            try {
                const jq = window.jQuery || window.$;
                if (jq && jq.fn && jq.fn.autocomplete) jq(textarea).autocomplete('close');
            } catch (e) {  }

            textarea.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
            }));

            ['keydown', 'keypress', 'keyup'].forEach(type => {
                textarea.dispatchEvent(new KeyboardEvent(type, {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
            });
            resolve(true);
        }, 50);
    });

    const base64EncodeUtf8 = (str) => btoa(unescape(encodeURIComponent(str)));

    const r20FontSyncInFlight = new Set();

    const r20LastSyncedAt = new Map();
    const R20_FONT_SYNC_MIN_INTERVAL_MS = 4000;

    const syncFontStyledContentToServer = async (handoutId, field, html) => {
        if (!handoutId || !field) return;
        const syncKey = handoutId + ':' + field;
        if (r20FontSyncInFlight.has(syncKey)) return;

        const now = Date.now();
        const lastAt = r20LastSyncedAt.get(syncKey) || 0;
        if (now - lastAt < R20_FONT_SYNC_MIN_INTERVAL_MS) return;
        r20LastSyncedAt.set(syncKey, now);

        r20FontSyncInFlight.add(syncKey);

        let previousTabId = null;
        let switchedTab = false;

        try {
            previousTabId = getActiveR20TabId();
            switchedTab = !!(previousTabId && previousTabId !== R20_CHAT_TAB_ID && clickR20Tab(R20_CHAT_TAB_ID));
            if (switchedTab) await new Promise(r => setTimeout(r, 120));

            const fullHtml = buildEmbeddedStyleBlock() + html;
            const b64 = base64EncodeUtf8(fullHtml);
            const totalChunks = Math.max(1, Math.ceil(b64.length / R20_FONT_SYNC_CHUNK_SIZE));

            for (let i = 0; i < totalChunks; i++) {
                const chunk = b64.slice(i * R20_FONT_SYNC_CHUNK_SIZE, (i + 1) * R20_FONT_SYNC_CHUNK_SIZE);
                const chunkWithBreaks = insertWordBreaks(chunk, R20_FONT_SYNC_WORD_BREAK_INTERVAL);
                const command = `!r20fontsync ${handoutId} ${field} ${i} ${totalChunks} ${chunkWithBreaks}`;
                const sent = await sendR20ChatMessage(command);
                if (!sent) {
                    console.warn('[R20-Custom-Editor] 채팅창을 찾지 못해 폰트 서버 동기화를 못 보냈습니다.');
                    break;
                }
                if (i < totalChunks - 1) {
                    await new Promise(r => setTimeout(r, R20_FONT_SYNC_CHUNK_DELAY_MS));
                }
            }
        } finally {
            if (switchedTab) clickR20Tab(previousTabId);
            r20FontSyncInFlight.delete(syncKey);
        }
    };

    const getHandoutSyncContext = (editor) => {
        const dialog = editor.closest('[data-handoutid]');
        const handoutId = dialog && dialog.getAttribute('data-handoutid');
        if (!handoutId) return null;
        const field = editor.closest('.gmnotes') ? 'gmnotes' : 'notes';
        return { handoutId, field };
    };

    const lastKnownEditorContent = new Map();

    document.addEventListener('input', (e) => {
        const editor = e.target.closest && e.target.closest('.note-editable');
        if (!editor) return;
        const ctx = getHandoutSyncContext(editor);
        if (!ctx) return;
        lastKnownEditorContent.set(editor, { ...ctx, html: editor.innerHTML });
    }, true);

    /* [ 붙여넣기 시 서식 정리 ] */
    const handlePasteFormatting = (e) => {
        const activeEl = document.activeElement;
        if (!activeEl || !activeEl.closest('.note-editable, .tox-edit-area')) return;

        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return;

        const htmlData = clipboardData.getData('text/html');
        if (htmlData) {
            e.preventDefault();
            e.stopPropagation();

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlData, 'text/html');

            if (doc.querySelector('style, link[rel="stylesheet"]')) {
                const stage = document.createElement('div');
                stage.style.cssText = 'position:fixed; left:-99999px; top:0; width:800px; visibility:hidden; pointer-events:none;';
                doc.querySelectorAll('style').forEach(styleEl => stage.appendChild(styleEl.cloneNode(true)));
                Array.from(doc.body.childNodes).forEach(node => stage.appendChild(node.cloneNode(true)));
                document.body.appendChild(stage);

                stage.querySelectorAll('*:not(style)').forEach(el => {
                    const computed = window.getComputedStyle(el);
                    ['textAlign', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecorationLine', 'color', 'backgroundColor', 'fontSize'].forEach(prop => {
                        const val = computed[prop];
                        if (val) el.style[prop] = val;
                    });
                });
                stage.querySelectorAll('style').forEach(el => el.remove());
                stage.querySelectorAll('*').forEach(el => el.removeAttribute('class'));

                doc.body.innerHTML = stage.innerHTML;
                document.body.removeChild(stage);
            } else {
                doc.querySelectorAll('*').forEach(el => el.removeAttribute('class'));
            }

            doc.querySelectorAll('table').forEach(table => {
                const col = table.querySelector('col');
                let w = col ? (col.getAttribute('width') || (col.getAttribute('style') || '').match(/width:\s*([\d.]+)/)?.[1]) : null;
                if (!w) {
                    w = table.getAttribute('width') || (table.getAttribute('style') || '').match(/width:\s*([\d.]+)/)?.[1];
                }
                if (w) {
                    table.style.width = w + 'px';
                    table.style.maxWidth = '100%';
                }
            });

            doc.querySelectorAll('*').forEach(el => {
                const fw = el.style.fontWeight;
                if (fw === 'bold' || fw === '700' || fw === '800' || fw === '900') {
                    el.style.fontWeight = '';
                    const strong = doc.createElement('strong');
                    strong.innerHTML = el.innerHTML;
                    el.innerHTML = '';
                    el.appendChild(strong);
                } else if (fw === 'normal' || fw === '400') {
                    el.style.fontWeight = '';
                }
            });

            doc.querySelectorAll('b').forEach(b => {
                const strong = doc.createElement('strong');
                strong.innerHTML = b.innerHTML;
                Array.from(b.attributes).forEach(attr => strong.setAttribute(attr.name, attr.value));
                b.parentNode.replaceChild(strong, b);
            });

            doc.querySelectorAll('img').forEach(img => {
                img.removeAttribute('width');
                img.removeAttribute('height');
                img.style.removeProperty('width');
                img.style.removeProperty('height');
                img.style.display = 'block';
                img.style.width = '100%';
                img.style.height = 'auto';
                const wrapper = img.parentElement;
                if (wrapper && wrapper.tagName === 'SPAN' && wrapper.childNodes.length === 1) {
                    wrapper.style.display = 'block';
                    wrapper.style.width = '100%';
                }
            });

            const processedHtml = doc.body.innerHTML;
            document.execCommand('insertHTML', false, processedHtml);
        }
    };

    /* [ 텍스트 스타일 적용 - 글자색/글자 배경색/폰트 공통 ] */
    const toCssPropertyName = (styleProperty) =>
        styleProperty.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

    const wrapSelectedTextRuns = (editor, range, cssProp, value) => {
        const rangeStartContainer = range.startContainer;
        const rangeStartOffset = range.startOffset;
        const rangeEndContainer = range.endContainer;
        const rangeEndOffset = range.endOffset;

        const textNodes = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
                if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) textNodes.push(n);

        const runs = textNodes.map(textNode => {
            let startOffset = textNode === rangeStartContainer ? rangeStartOffset : 0;
            let endOffset = textNode === rangeEndContainer ? rangeEndOffset : textNode.nodeValue.length;
            startOffset = Math.max(0, Math.min(startOffset, textNode.nodeValue.length));
            endOffset = Math.max(0, Math.min(endOffset, textNode.nodeValue.length));
            return { textNode, startOffset, endOffset };
        });

        const createdSpans = [];

        for (let i = runs.length - 1; i >= 0; i--) {
            const { textNode, startOffset, endOffset } = runs[i];
            if (!textNode.parentNode) continue;
            if (startOffset >= endOffset) continue;

            let targetNode = textNode;
            if (endOffset < targetNode.nodeValue.length) targetNode.splitText(endOffset);
            if (startOffset > 0) targetNode = targetNode.splitText(startOffset);

            const span = document.createElement('span');

            const priority = cssProp === 'font-family' ? '' : 'important';
            span.style.setProperty(cssProp, value, priority);
            targetNode.parentNode.insertBefore(span, targetNode);
            span.appendChild(targetNode);
            createdSpans.push(span);
        }

        return createdSpans;
    };

    const applyTextStyle = (styleProperty, value) => {
        if (!restoreSelection()) return;
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const editor = getEditorFromNode(range.commonAncestorContainer);
        if (!editor || !editor.contains(range.commonAncestorContainer)) return;

        const cssProp = toCssPropertyName(styleProperty);

        if (selection.isCollapsed) {

            const span = document.createElement('span');
            span.style.setProperty(cssProp, value, cssProp === 'font-family' ? '' : 'important');
            span.textContent = '\u200B';
            range.insertNode(span);

            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);

            savedRange = newRange.cloneRange();
            savedEditor = editor;
            return;
        }

        wrapSelectedTextRuns(editor, range, cssProp, value);

        editor.focus();
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatSetBlockTextDirection' }));

        const newSelection = window.getSelection();
        if (newSelection && newSelection.rangeCount) {
            savedRange = newSelection.getRangeAt(0).cloneRange();
            savedEditor = editor;
        }
    };

    /* [ 표(테이블) 칸 격자 계산 & 드래그 다중 선택 감지 ] */

    const buildTableGrid = (table) => {
        const grid = [];
        Array.from(table.rows).forEach((row, r) => {
            if (!grid[r]) grid[r] = [];
            let c = 0;
            Array.from(row.cells).forEach(cell => {
                while (grid[r][c]) c++;
                const rowspan = cell.rowSpan || 1;
                const colspan = cell.colSpan || 1;
                for (let rr = r; rr < r + rowspan; rr++) {
                    if (!grid[rr]) grid[rr] = [];
                    for (let cc = c; cc < c + colspan; cc++) {
                        grid[rr][cc] = cell;
                    }
                }
                c += colspan;
            });
        });
        return grid;
    };

    const findCellTopLeft = (grid, cell) => {
        for (let r = 0; r < grid.length; r++) {
            const row = grid[r] || [];
            for (let c = 0; c < row.length; c++) {
                if (row[c] === cell) return { r, c };
            }
        }
        return null;
    };

    const getSelectedTableCells = () => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return [];

        const closestCell = (node) => {
            if (!node) return null;
            if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
            return node.closest ? node.closest('td, th') : null;
        };

        if (selection.rangeCount > 1) {
            const cells = new Set();
            for (let i = 0; i < selection.rangeCount; i++) {
                const range = selection.getRangeAt(i);
                const cell = closestCell(range.commonAncestorContainer);
                if (cell) cells.add(cell);
            }
            if (cells.size) return Array.from(cells);
        }

        const range = selection.getRangeAt(0);
        const startCell = closestCell(range.startContainer);
        const endCell = closestCell(range.endContainer);

        if (startCell && startCell === endCell) return [startCell];

        if (startCell && endCell) {
            const table = startCell.closest('table');
            if (table && endCell.closest('table') === table) {
                const grid = buildTableGrid(table);
                const posA = findCellTopLeft(grid, startCell);
                const posB = findCellTopLeft(grid, endCell);
                if (posA && posB) {
                    const minR = Math.min(posA.r, posB.r), maxR = Math.max(posA.r, posB.r);
                    const minC = Math.min(posA.c, posB.c), maxC = Math.max(posA.c, posB.c);
                    const cells = new Set();
                    for (let r = minR; r <= maxR; r++) {
                        for (let c = minC; c <= maxC; c++) {
                            const cell = grid[r] && grid[r][c];
                            if (cell) cells.add(cell);
                        }
                    }
                    if (cells.size) return Array.from(cells);
                }
            }
        }

        let node = range.commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const directCell = node.closest ? node.closest('td, th') : null;
        if (directCell) return [directCell];
        const table = node.closest ? node.closest('table') : null;
        if (!table) return [];
        const cells = [];
        table.querySelectorAll('td, th').forEach(cell => {
            if (range.intersectsNode(cell)) cells.push(cell);
        });
        return cells;
    };

    let highlightedTableCells = new Set();

    const clearTableCellHighlight = () => {
        if (highlightedTableCells.size === 0) return;
        highlightedTableCells.forEach(cell => cell.classList.remove('r20-table-cell-selected'));
        highlightedTableCells.clear();
    };

    const updateTableCellHighlight = () => {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) {
            clearTableCellHighlight();
            return;
        }

        const anchorEditor = getEditorFromNode(selection.anchorNode);
        if (!anchorEditor) {
            clearTableCellHighlight();
            return;
        }

        const cells = getSelectedTableCells();
        if (cells.length < 2) {
            clearTableCellHighlight();
            return;
        }

        const nextSet = new Set(cells);
        highlightedTableCells.forEach(cell => {
            if (!nextSet.has(cell)) cell.classList.remove('r20-table-cell-selected');
        });
        nextSet.forEach(cell => cell.classList.add('r20-table-cell-selected'));
        highlightedTableCells = nextSet;
    };

    /* [ 표 칸 합치기 / 나누기 ] */

    const mergeSelectedTableCells = () => {
        const cells = getSelectedTableCells();
        if (cells.length < 2) {
            alert('합칠 칸을 2개 이상 드래그로 선택한 다음 다시 시도해주세요.');
            return;
        }

        const table = cells[0].closest('table');
        if (!table || cells.some(c => c.closest('table') !== table)) {
            alert('같은 표 안의 칸끼리만 합칠 수 있습니다.');
            return;
        }

        const grid = buildTableGrid(table);
        const cellSet = new Set(cells);

        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        cells.forEach(cell => {
            const pos = findCellTopLeft(grid, cell);
            if (!pos) return;
            const rowspan = cell.rowSpan || 1;
            const colspan = cell.colSpan || 1;
            minR = Math.min(minR, pos.r); maxR = Math.max(maxR, pos.r + rowspan - 1);
            minC = Math.min(minC, pos.c); maxC = Math.max(maxC, pos.c + colspan - 1);
        });

        const involvedCells = new Set();
        for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
                const cell = grid[r] && grid[r][c];
                if (!cell || !cellSet.has(cell)) {
                    alert('선택한 칸이 사각형 모양이 아니라 합칠 수 없습니다. 표를 사각형 형태로 드래그해서 선택해주세요.');
                    return;
                }
                involvedCells.add(cell);
            }
        }

        const orderedCells = Array.from(involvedCells).sort((a, b) => {
            const pa = findCellTopLeft(grid, a), pb = findCellTopLeft(grid, b);
            return (pa.r - pb.r) || (pa.c - pb.c);
        });

        const topLeftCell = orderedCells[0];
        const mergedHTML = orderedCells
            .map(c => c.innerHTML.trim())
            .filter(html => html && html !== '<br>')
            .join(' ');

        topLeftCell.colSpan = maxC - minC + 1;
        topLeftCell.rowSpan = maxR - minR + 1;
        topLeftCell.innerHTML = mergedHTML || '<br>';

        orderedCells.forEach(cell => {
            if (cell !== topLeftCell) cell.remove();
        });

        clearTableCellHighlight();

        const editor = getEditorFromNode(table);
        notifyEditorContentChanged(editor);

        const newSelection = window.getSelection();
        const newRange = document.createRange();
        newRange.selectNodeContents(topLeftCell);
        newRange.collapse(false);
        newSelection.removeAllRanges();
        newSelection.addRange(newRange);
        savedRange = newRange.cloneRange();
        savedEditor = editor;
    };

    const splitSelectedTableCell = () => {
        const selection = window.getSelection();
        let node = selection.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const cell = node && node.closest ? node.closest('td, th') : null;

        if (!cell) {
            alert('나눌 칸 안에 커서를 놓은 다음 다시 시도해주세요.');
            return;
        }

        const rowspan = cell.rowSpan || 1;
        const colspan = cell.colSpan || 1;
        if (rowspan <= 1 && colspan <= 1) {
            alert('이 칸은 합쳐진 칸이 아니라서 나눌 수 없습니다.');
            return;
        }

        const table = cell.closest('table');
        const grid = buildTableGrid(table);
        const pos = findCellTopLeft(grid, cell);
        if (!pos) return;

        const rows = Array.from(table.rows);
        const tagName = cell.tagName.toLowerCase();

        cell.removeAttribute('colspan');
        cell.removeAttribute('rowspan');
        cell.colSpan = 1;
        cell.rowSpan = 1;

        for (let r = pos.r; r < pos.r + rowspan; r++) {
            for (let c = pos.c; c < pos.c + colspan; c++) {
                if (r === pos.r && c === pos.c) continue;

                const newCell = document.createElement(tagName);
                newCell.innerHTML = '<br>';

                const rowEl = rows[r];
                let insertBeforeEl = null;
                for (let cc = c + 1; cc < (grid[r] || []).length; cc++) {
                    const candidate = grid[r][cc];
                    if (candidate && candidate.parentNode === rowEl) {
                        insertBeforeEl = candidate;
                        break;
                    }
                }
                if (insertBeforeEl) {
                    rowEl.insertBefore(newCell, insertBeforeEl);
                } else {
                    rowEl.appendChild(newCell);
                }

                if (!grid[r]) grid[r] = [];
                grid[r][c] = newCell;
            }
        }

        notifyEditorContentChanged(getEditorFromNode(table));
    };

    /* [ 표 칸 배경색 / 테두리, 가름줄 스타일 적용 ] */

    const applyTableCellBackground = (color) => {
        restoreSelection();
        const cells = getSelectedTableCells();

        if (cells.length === 0) {
            alert('표의 칸 안에 커서를 놓거나, 칸을 드래그로 선택한 다음 다시 시도해주세요.');
            return;
        }
        cells.forEach(cell => { cell.style.backgroundColor = color; });
        notifyEditorContentChanged(getEditorFromNode(cells[0]));
    };

    const applyTableCellBorder = (color, widthPx, style) => {
        restoreSelection();
        const cells = getSelectedTableCells();

        if (cells.length === 0) {
            alert('표의 칸 안에 커서를 놓거나, 칸을 드래그로 선택한 다음 다시 시도해주세요.');
            return;
        }
        const w = Math.max(1, parseInt(widthPx, 10) || 1);
        cells.forEach(cell => { cell.style.border = `${w}px ${style} ${color}`; });
        notifyEditorContentChanged(getEditorFromNode(cells[0]));
    };

    const applyHrStyle = (color, widthPx, style) => {
        if (!selectedHrEl || !selectedHrEl.isConnected) {
            alert('먼저 스타일을 바꿀 가름줄(구분선)을 클릭해서 선택한 다음 다시 시도해주세요.');
            return;
        }
        const w = Math.max(1, parseInt(widthPx, 10) || 1);
        selectedHrEl.style.border = 'none';
        selectedHrEl.style.borderTop = `${w}px ${style} ${color}`;
        selectedHrEl.style.height = '0';
    };

    /* [ 가름줄(구분선) 삽입 팝업 UI ] */

    const insertStyledHr = (editor, color, widthPx, style) => {
        editor.focus();
        restoreSelection();

        const selection = window.getSelection();
        if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
            const fallbackRange = document.createRange();
            fallbackRange.selectNodeContents(editor);
            fallbackRange.collapse(false);
            selection.removeAllRanges();
            selection.addRange(fallbackRange);
        }

        const w = Math.max(1, parseInt(widthPx, 10) || 1);
        const hrHTML = `<hr style="border:none; border-top:${w}px ${style} ${color}; height:0;">`;
        document.execCommand('insertHTML', false, hrHTML);
    };

    const openHrInsertPopover = (editor, anchorBtn) => {
        document.getElementById('r20-hr-insert-popover')?.remove();

        saveSelection();

        const rect = anchorBtn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.id = 'r20-hr-insert-popover';
        pop.style.cssText = `
            position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px;
            background: #fff; border: 1px solid #ccc; border-radius: 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 999999;
            padding: 10px; width: 240px; font-family: sans-serif; font-size: 12px;
            color: #333; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px;
        `;

        pop.innerHTML = `
            <label style="display:block; margin:0; color:#555; font-weight:bold;">➖ 가름줄(구분선) 삽입</label>
            <div style="display:flex; align-items:center; gap:4px; width:100%; box-sizing:border-box;">
                <input type="color" class="r20-hr-color" value="#cccccc" style="width: 26px; height: 24px !important; padding: 0; margin: 0; border: 1px solid #ccc; cursor: pointer; flex-shrink:0; box-sizing:border-box;">
                <input type="number" class="r20-hr-width" value="1" min="1" max="20" style="width: 38px; height: 24px !important; line-height: 22px !important; font-size: 11px; text-align:center; padding:0; margin:0; border:1px solid #ccc; background:#fff; color:#000; flex-shrink:0; box-sizing:border-box;">
                <span style="flex-shrink:0;">px</span>
                <select class="r20-hr-style" style="flex:1; min-width:0; height: 24px !important; line-height: 22px !important; font-size: 11px; padding: 0 2px; margin:0; border:1px solid #ccc; background:#fff; color:#000; box-sizing:border-box;">
                    <option value="solid">실선</option>
                    <option value="dashed">파선</option>
                    <option value="dotted">점선</option>
                    <option value="double">이중선</option>
                </select>
            </div>
            <button type="button" class="r20-hr-insert-btn btn btn-primary btn-sm" style="width:100%; padding:4px 0; cursor:pointer; box-sizing:border-box; margin:0;">삽입</button>
        `;

        document.body.appendChild(pop);
        pop.addEventListener('mousedown', (e) => e.stopPropagation());
        const closePop = attachOutsideClickClose(pop, anchorBtn);

        pop.querySelector('.r20-hr-insert-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const color = pop.querySelector('.r20-hr-color').value;
            const width = pop.querySelector('.r20-hr-width').value;
            const style = pop.querySelector('.r20-hr-style').value;

            insertStyledHr(editor, color, width, style);
            closePop();
        });
    };

    const injectHrInsertButton = () => {
        const toolbars = document.querySelectorAll('.note-toolbar, .tox-toolbar__group');

        toolbars.forEach(toolbar => {
            const hrBtn = Array.from(toolbar.querySelectorAll('button')).find(btn =>
                !btn.dataset.customHrPopover && (
                    btn.querySelector('.note-icon-minus') ||
                    (btn.getAttribute('data-original-title') || '').toLowerCase().includes('horizontal') ||
                    (btn.getAttribute('title') || '').toLowerCase().includes('horizontal') ||
                    (btn.getAttribute('aria-label') || '').toLowerCase().includes('horizontal')
                )
            );
            if (!hrBtn) return;

            const freshBtn = hrBtn.cloneNode(true);
            freshBtn.dataset.customHrPopover = 'true';
            freshBtn.title = '가름줄(구분선) 삽입';
            freshBtn.setAttribute('aria-label', '가름줄(구분선) 삽입');
            hrBtn.parentNode.replaceChild(freshBtn, hrBtn);

            const caret = document.createElement('span');
            caret.className = 'note-icon-caret';
            caret.style.cssText = 'margin-left:3px; pointer-events:none;';
            freshBtn.appendChild(caret);

            freshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const editor = toolbar.closest('.note-editor, .tox-tinymce')?.querySelector('.note-editable, .tox-edit-area');
                if (!editor) {
                    alert('에디터 영역을 찾을 수 없습니다.');
                    return;
                }

                toggleCustomPopover('r20-hr-insert-popover', () => openHrInsertPopover(editor, freshBtn));
            });
        });
    };

    /* [ 이미지 URL 정리 & 라이트박스(확대보기) ] */
    const cleanRoll20ImageUrl = (rawUrl) => {
        if (!rawUrl) return '';
        let clean = rawUrl.replace(/(\/thumb\.png|\/med\.png|\/max\.png)/g, '/original.png');
        clean = clean.replace(/\?.*$/, '');
        return clean;
    };

    const openLightbox = (imgSrc) => {
        let box = document.getElementById('r20-custom-lightbox-overlay');
        if (box) box.remove();

        box = document.createElement('div');
        box.id = 'r20-custom-lightbox-overlay';
        box.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:999999; display:flex; align-items:center; justify-content:center; cursor:zoom-out; user-select:none;';

        box.innerHTML = `
            <img src="${imgSrc}" referrerpolicy="no-referrer" style="max-width:92vw; max-height:92vh; object-fit:contain; box-shadow:0 0 20px rgba(0,0,0,0.8); border-radius:4px; cursor:default;">
            <span style="position:absolute; top:20px; right:25px; color:#fff; font-size:30px; font-weight:bold; cursor:pointer;">&times;</span>
        `;

        box.addEventListener('click', () => box.remove());
        box.querySelector('img').addEventListener('click', (e) => e.stopPropagation());

        document.body.appendChild(box);
    };

    /* [ 표 크기 조절 - 열 너비 / 행 높이 드래그 ] */
    const makeTablesResizable = () => {
        const tables = document.querySelectorAll('.note-editable table, .tox-edit-area table');

        tables.forEach(table => {
            if (table.dataset.resizableInit) return;
            table.dataset.resizableInit = 'true';
            table.style.tableLayout = 'fixed';

            const rows = table.rows;
            if (!rows || rows.length === 0) return;

            Array.from(rows).forEach(row => {
                const cells = row.cells;
                Array.from(cells).forEach((cell) => {
                    let resizer = cell.querySelector('.r20-table-resizer');
                    if (!resizer) {
                        resizer = document.createElement('div');
                        resizer.className = 'r20-table-resizer';
                        resizer.style.cssText = 'position:absolute; top:0; right:-3px; width:6px; cursor:col-resize; user-select:none; height:100%; z-index:10;';
                        cell.style.position = 'relative';
                        cell.appendChild(resizer);
                    }

                    let x = 0;
                    let w = 0;

                    const mouseMoveHandler = (e) => {
                        const dx = e.clientX - x;
                        const newWidth = Math.max(20, w + dx);
                        cell.style.width = newWidth + 'px';
                    };

                    const mouseUpHandler = () => {
                        document.removeEventListener('mousemove', mouseMoveHandler);
                        document.removeEventListener('mouseup', mouseUpHandler);
                    };

                    resizer.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        x = e.clientX;
                        w = cell.offsetWidth;
                        document.addEventListener('mousemove', mouseMoveHandler);
                        document.addEventListener('mouseup', mouseUpHandler);
                    });

                    let rowResizer = cell.querySelector('.r20-table-row-resizer');
                    if (!rowResizer) {
                        rowResizer = document.createElement('div');
                        rowResizer.className = 'r20-table-row-resizer';
                        rowResizer.style.cssText = 'position:absolute; left:0; bottom:-3px; width:100%; cursor:row-resize; user-select:none; height:6px; z-index:10;';
                        cell.style.position = 'relative';
                        cell.appendChild(rowResizer);
                    }

                    let ry = 0;
                    let rh = 0;

                    const rowMouseMoveHandler = (e) => {
                        const dy = e.clientY - ry;
                        const newHeight = Math.max(16, rh + dy);
                        row.style.height = newHeight + 'px';
                    };

                    const rowMouseUpHandler = () => {
                        document.removeEventListener('mousemove', rowMouseMoveHandler);
                        document.removeEventListener('mouseup', rowMouseUpHandler);
                    };

                    rowResizer.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ry = e.clientY;
                        rh = row.offsetHeight;
                        document.addEventListener('mousemove', rowMouseMoveHandler);
                        document.addEventListener('mouseup', rowMouseUpHandler);
                    });
                });
            });
        });
    };

    /* [ 잘못 감싸진 인라인 태그(strong/b/em/i/u/font) 풀어주기 ] */
    const fixInvalidInlineWrapping = () => {
        const INLINE_SELECTOR = 'strong, b, em, i, u, font';
        const BLOCK_TAGS = ['DIV', 'TABLE', 'P', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
        let changedAny = false;

        document.querySelectorAll('.note-editable, .tox-edit-area, .handoutviewer').forEach(root => {
            let found = true;
            let guard = 0;

            while (found && guard < 10) {
                found = false;
                guard++;

                root.querySelectorAll(INLINE_SELECTOR).forEach(inlineEl => {
                    const blockChild = Array.from(inlineEl.children).find(c => BLOCK_TAGS.includes(c.tagName));
                    if (!blockChild) return;

                    const tag = inlineEl.tagName.toLowerCase();
                    if ((tag === 'strong' || tag === 'b') && !blockChild.style.fontWeight) {
                        blockChild.style.fontWeight = 'bold';
                    } else if ((tag === 'em' || tag === 'i') && !blockChild.style.fontStyle) {
                        blockChild.style.fontStyle = 'italic';
                    } else if (tag === 'u' && !blockChild.style.textDecoration) {
                        blockChild.style.textDecoration = 'underline';
                    } else if (tag === 'font') {
                        if (inlineEl.color && !blockChild.style.color) blockChild.style.color = inlineEl.color;
                        if (inlineEl.face && !blockChild.style.fontFamily) blockChild.style.fontFamily = inlineEl.face;
                    }

                    while (inlineEl.firstChild) {
                        inlineEl.parentNode.insertBefore(inlineEl.firstChild, inlineEl);
                    }
                    inlineEl.parentNode.removeChild(inlineEl);

                    found = true;
                    changedAny = true;
                });
            }
        });

        if (changedAny) {
            document.querySelectorAll('.note-editable table, .tox-edit-area table, .handoutviewer table').forEach(t => {
                delete t.dataset.alignNormalized;
            });
        }
    };

    /* [ 표 가운데 정렬 자동 보정 ] */
    const normalizeTableAlignment = () => {
        const tables = document.querySelectorAll(
            '.note-editable table, .tox-edit-area table, .handoutviewer table'
        );

        tables.forEach(table => {
            if (table.dataset.alignNormalized) return;

            const hasMarginLeft = !!table.style.marginLeft;
            const hasMarginRight = !!table.style.marginRight;

            if (hasMarginLeft || hasMarginRight) {
                table.dataset.alignNormalized = 'true';
                return;
            }

            const container = table.parentElement;
            const containerWidth = container ? container.clientWidth : 0;
            const tableWidth = table.offsetWidth;

            if (!containerWidth || !tableWidth) return;

            if (tableWidth < containerWidth * 0.98) {
                table.style.marginLeft = 'auto';
                table.style.marginRight = 'auto';
            }

            table.dataset.alignNormalized = 'true';
        });
    };

    /* [ v1.24에서 잘못 저장된 잔재 정리 ] */
    const cleanupLegacyDisplayBake = () => {
        document.querySelectorAll('[data-display-baked]').forEach(p => {
            p.style.removeProperty('display');
            if (p.getAttribute('style') !== null && p.getAttribute('style').trim() === '') {
                p.removeAttribute('style');
            }
            p.removeAttribute('data-display-baked');
        });
    };

    /* [ 아바타(핸드아웃 대표 이미지) 자리에 "미리보기 아이콘" 라벨 표시 ] */
    const forceInjectLabelDOM = () => {
        document.querySelectorAll('.avatar.dropbox').forEach(target => {
            if (!(target.parentNode && target.parentNode.querySelector('.r20-real-preview-label'))) {
                const label = document.createElement('div');
                label.className = 'r20-real-preview-label';
                label.textContent = '미리보기 아이콘';
                target.parentNode.insertBefore(label, target);
            }

            checkAvatarChangedAndSync(target);
        });
    };

    const r20AvatarLastBg = new WeakMap();
    const checkAvatarChangedAndSync = (avatarEl) => {
        const bg = getComputedStyle(avatarEl).backgroundImage;
        const hadPrev = r20AvatarLastBg.has(avatarEl);
        const prevBg = r20AvatarLastBg.get(avatarEl);
        r20AvatarLastBg.set(avatarEl, bg);

        if (!hadPrev || !bg || bg === 'none' || bg === prevBg) return;

        const dialog = avatarEl.closest('[data-handoutid]');
        const handoutId = dialog && dialog.getAttribute('data-handoutid');
        if (!handoutId) return;

        const notesEditor = Array.from(dialog.querySelectorAll('.note-editable')).find(el => !el.closest('.gmnotes'));
        if (!notesEditor) return;

        syncFontStyledContentToServer(handoutId, 'notes', notesEditor.innerHTML);
    };

    /* [ 템플릿 저장/관리 - localStorage 데이터 입출력 ] */
    const getTemplates = () => {
        try {
            return JSON.parse(localStorage.getItem('r20_custom_templates_v2') || '[]');
        } catch (e) {
            return [];
        }
    };

    const saveTemplates = (templates) => {
        localStorage.setItem('r20_custom_templates_v2', JSON.stringify(templates));
    };

    /* [ 템플릿 저장 팝업 UI ] */

    const openTemplateSavePopover = (editor, anchorBtn) => {
        document.getElementById('r20-tm-save-popover')?.remove();

        const content = editor.innerHTML.trim();
        if (!content || content === '<p><br></p>') {
            alert('저장할 내용이 없습니다.');
            return;
        }

        const rect = anchorBtn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.id = 'r20-tm-save-popover';
        pop.style.cssText = `
            position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px;
            background: #fff; border: 1px solid #ccc; border-radius: 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 999999;
            padding: 10px; width: 230px; font-family: sans-serif; font-size: 12px;
            color: #333;
        `;

        pop.innerHTML = `
            <label style="display:block; margin-bottom:4px; color:#555; font-weight:bold;">📥 템플릿으로 저장</label>
            <div style="display:flex; gap:4px;">
                <input type="text" class="r20-tm-save-name" placeholder="템플릿 이름" style="flex:1; min-width:0; padding:3px 5px; border:1px solid #ccc; border-radius:3px; color:#000; background:#fff;">
                <button type="button" class="r20-tm-save-btn btn btn-primary btn-sm" style="cursor:pointer;">저장</button>
            </div>
        `;

        document.body.appendChild(pop);
        pop.addEventListener('mousedown', (e) => e.stopPropagation());
        const closePop = attachOutsideClickClose(pop, anchorBtn);

        const nameInput = pop.querySelector('.r20-tm-save-name');
        const doSave = () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }

            const templates = getTemplates();
            templates.push({ id: Date.now().toString(), name, html: content });
            saveTemplates(templates);
            closePop();
        };

        pop.querySelector('.r20-tm-save-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doSave();
        });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        });
        nameInput.focus();
    };

    /* [ 템플릿 관리 / 불러오기 모달 UI ] */

    const openTemplateManagerModal = (editor, anchorBtn) => {
        let modal = document.getElementById('r20-template-manager-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'r20-template-manager-modal';
        modal.style.cssText = 'position:fixed; width:300px; max-height:70vh; background:#fff; border:1px solid #ccc; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,0.3); z-index:999999; padding:10px; font-family:sans-serif; font-size:12px; color:#333; display:flex; flex-direction:column; user-select:none; overflow:hidden;';

        const renderList = () => {
            const templates = getTemplates();
            const bodyEl = modal.querySelector('#r20-tm-body');

            if (templates.length === 0) {
                bodyEl.innerHTML = '<div style="padding:30px; text-align:center; color:#777; font-size:12px;">저장된 템플릿이 없습니다.</div>';
                return;
            }

            bodyEl.innerHTML = templates.map((t, idx) => `
                <div data-index="${idx}" style="display:flex; align-items:center; padding:8px 10px; border-bottom:1px solid #eee; gap:8px; background:#fafafa;">
                    <div class="r20-tm-preview" style="width:52px; height:36px; overflow:hidden; border:1px solid #ccc; border-radius:3px; background:#fff; flex-shrink:0; position:relative;">
                        <div class="r20-tm-preview-inner" style="transform-origin: top left; transform: scale(0.17); width:300px; pointer-events:none;"></div>
                    </div>
                    <div style="flex:1; overflow:hidden; min-width:0;">
                        <input type="text" class="r20-tm-name-input" value="${t.name}" style="width:100%; font-size:12px; padding:2px 4px; border:1px solid transparent; background:transparent; border-radius:3px;" readonly>
                    </div>
                    <div style="display:flex; gap:2px; align-items:center; flex-shrink:0;">
                        <button class="r20-tm-load btn btn-xs btn-success" style="font-size:11px; padding:2px 5px; cursor:pointer;" title="불러오기">📥</button>
                        <button class="r20-tm-edit btn btn-xs btn-default" style="font-size:11px; padding:2px 5px; cursor:pointer;" title="이름 수정">✏️</button>
                        <button class="r20-tm-up btn btn-xs btn-default" style="font-size:11px; padding:2px 4px; cursor:pointer;" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
                        <button class="r20-tm-down btn btn-xs btn-default" style="font-size:11px; padding:2px 4px; cursor:pointer;" ${idx === templates.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
                        <button class="r20-tm-del btn btn-xs btn-danger" style="font-size:11px; padding:2px 5px; cursor:pointer;" title="삭제">🗑️</button>
                    </div>
                </div>
            `).join('');

            bodyEl.querySelectorAll('div[data-index]').forEach(row => {
                const i = parseInt(row.dataset.index, 10);
                const previewInner = row.querySelector('.r20-tm-preview-inner');
                if (previewInner) previewInner.innerHTML = templates[i].html;
            });

            bodyEl.querySelectorAll('div[data-index]').forEach(row => {
                const i = parseInt(row.dataset.index, 10);
                const nameInput = row.querySelector('.r20-tm-name-input');

                row.querySelector('.r20-tm-load').addEventListener('click', () => {
                    const ts = getTemplates();
                    if (ts[i]) {
                        editor.focus();
                        document.execCommand('insertHTML', false, ts[i].html);
                        closeModal();
                    }
                });

                const editBtn = row.querySelector('.r20-tm-edit');
                editBtn.addEventListener('click', () => {
                    if (nameInput.hasAttribute('readonly')) {
                        nameInput.removeAttribute('readonly');
                        nameInput.style.border = '1px solid #ccc';
                        nameInput.style.background = '#fff';
                        nameInput.focus();
                        editBtn.textContent = '💾';
                    } else {
                        const ts = getTemplates();
                        ts[i].name = nameInput.value.trim() || '무제 템플릿';
                        saveTemplates(ts);
                        renderList();
                    }
                });

                row.querySelector('.r20-tm-up').addEventListener('click', () => {
                    if (i > 0) {
                        const ts = getTemplates();
                        const temp = ts[i];
                        ts[i] = ts[i - 1];
                        ts[i - 1] = temp;
                        saveTemplates(ts);
                        renderList();
                    }
                });

                row.querySelector('.r20-tm-down').addEventListener('click', () => {
                    const ts = getTemplates();
                    if (i < ts.length - 1) {
                        const temp = ts[i];
                        ts[i] = ts[i + 1];
                        ts[i + 1] = temp;
                        saveTemplates(ts);
                        renderList();
                    }
                });

                row.querySelector('.r20-tm-del').addEventListener('click', () => {
                    if (confirm(`'${templates[i].name}' 템플릿을 삭제하시겠습니까?`)) {
                        const ts = getTemplates();
                        ts.splice(i, 1);
                        saveTemplates(ts);
                        renderList();
                    }
                });
            });
        };

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <label style="margin:0; color:#555; font-weight:bold;">📤 템플릿 관리 및 불러오기</label>
                <span id="r20-tm-close" style="cursor:pointer; color:#999; font-size:14px; line-height:1;">&times;</span>
            </div>
            <div id="r20-tm-body" style="overflow-y:auto; max-height:60vh; background:#fff; border-top:1px solid #eee; margin:0 -10px; padding-top:0;"></div>
        `;

        document.body.appendChild(modal);
        modal.addEventListener('mousedown', (e) => e.stopPropagation());
        positionFixedDropdown(modal, anchorBtn);
        const closeModal = attachOutsideClickClose(modal, anchorBtn);

        modal.querySelector('#r20-tm-close').addEventListener('click', () => {
            closeModal();
        });

        renderList();
    };

    /* [ 툴바 버튼 삽입 - 템플릿 저장/불러오기, 표 칸 합치기/나누기 ] */
    const injectTemplateButtons = () => {
        const toolbars = document.querySelectorAll('.note-toolbar, .tox-toolbar__group');

        toolbars.forEach(toolbar => {
            if (toolbar.querySelector('.custom-template-btn-group')) return;

            const trashBtn = toolbar.querySelector('button:has(.note-icon-trash), .note-trash, button[title*="Trash"], button[aria-label*="Trash"]');
            if (!trashBtn) return;

            const btnWrapper = document.createElement('div');
            btnWrapper.className = 'note-btn-group btn-group custom-template-btn-group';

            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'note-btn btn btn-default btn-sm';
            saveBtn.title = '템플릿 저장';
            saveBtn.setAttribute('aria-label', '템플릿 저장');
            saveBtn.innerHTML = `📥`;

            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const editor = toolbar.closest('.note-editor, .tox-tinymce')?.querySelector('.note-editable, .tox-edit-area');
                if (!editor) {
                    alert('에디터 영역을 찾을 수 없습니다.');
                    return;
                }

                toggleCustomPopover('r20-tm-save-popover', () => openTemplateSavePopover(editor, saveBtn));
            });

            const loadBtn = document.createElement('button');
            loadBtn.type = 'button';
            loadBtn.className = 'note-btn btn btn-default btn-sm';
            loadBtn.title = '템플릿 관리/불러오기';
            loadBtn.setAttribute('aria-label', '템플릿 관리/불러오기');
            loadBtn.innerHTML = `📤`;

            loadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const editor = toolbar.closest('.note-editor, .tox-tinymce')?.querySelector('.note-editable, .tox-edit-area');
                if (!editor) {
                    alert('에디터 영역을 찾을 수 없습니다.');
                    return;
                }

                toggleCustomPopover('r20-template-manager-modal', () => openTemplateManagerModal(editor, loadBtn));
            });

            btnWrapper.appendChild(saveBtn);
            btnWrapper.appendChild(loadBtn);

            const trashParent = trashBtn.closest('.btn-group') || trashBtn;
            if (trashParent.nextSibling) {
                trashParent.parentNode.insertBefore(btnWrapper, trashParent.nextSibling);
            } else {
                trashParent.parentNode.appendChild(btnWrapper);
            }
        });
    };

    const injectTableMergeSplitButtons = () => {
        const toolbars = document.querySelectorAll('.note-toolbar, .tox-toolbar__group');

        toolbars.forEach(toolbar => {
            if (toolbar.querySelector('.custom-table-mergesplit-btn')) return;

            const rowDeleteBtn = toolbar.querySelector('button:has(.note-icon-row-remove), button[title*="Delete row"], button[data-original-title*="Delete row"], button[aria-label*="Delete row"]');
            if (!rowDeleteBtn) return;

            const mergeBtn = document.createElement('button');
            mergeBtn.type = 'button';
            mergeBtn.className = 'note-btn btn btn-default btn-sm custom-table-mergesplit-btn';
            mergeBtn.title = '칸 합치기 (드래그로 여러 칸 선택 후 클릭)';
            mergeBtn.setAttribute('aria-label', '칸 합치기');
            mergeBtn.innerHTML = `⛓️`;

            mergeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                mergeSelectedTableCells();
            });

            const splitBtn = document.createElement('button');
            splitBtn.type = 'button';
            splitBtn.className = 'note-btn btn btn-default btn-sm custom-table-mergesplit-btn';
            splitBtn.title = '칸 나누기 (합쳐진 칸 안에 커서를 놓고 클릭)';
            splitBtn.setAttribute('aria-label', '칸 나누기');
            splitBtn.innerHTML = `✂️`;

            splitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                splitSelectedTableCell();
            });

            const deleteGroup = rowDeleteBtn.closest('.btn-group') || rowDeleteBtn.parentNode;
            deleteGroup.insertBefore(mergeBtn, rowDeleteBtn);
            deleteGroup.insertBefore(splitBtn, rowDeleteBtn);
        });
    };

    /* [ 이미지 삽입 공통 유틸 ] */

    const getRangeFromPoint = (x, y) => {
        if (document.caretRangeFromPoint) {
            return document.caretRangeFromPoint(x, y);
        }
        if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos && pos.offsetNode) {
                const range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
                return range;
            }
        }
        return null;
    };

    const insertImageAtCursor = (editor, imgSrc, range) => {
        editor.focus();

        const selection = window.getSelection();
        if (range) {
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            restoreSelection();
            if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
                const fallbackRange = document.createRange();
                fallbackRange.selectNodeContents(editor);
                fallbackRange.collapse(false);
                selection.removeAllRanges();
                selection.addRange(fallbackRange);
            }
        }

        const inserted = document.execCommand('insertImage', false, imgSrc);
        if (!inserted) {
            document.execCommand('insertHTML', false, `<img src="${imgSrc}">`);
        }
    };

    /* [ 롤20 "아트 라이브러리" 항목을 드래그해서 편집창에 이미지 삽입 ] */

    const extractLibraryDragUrl = (dragEl) => {
        if (!dragEl) return '';
        const item = (dragEl.closest && dragEl.closest('.library-item, .dd-item')) || dragEl;
        if (item.dataset && item.dataset.fullsizeurl) return item.dataset.fullsizeurl;
        const img = item.querySelector && item.querySelector('img');
        return img ? img.src : '';
    };

    const libraryDropTargets = [];

    const registerLibraryDropTarget = (el, editor, onDrop) => {
        if (!el) return;
        const existing = libraryDropTargets.find(t => t.el === el);
        if (existing) {
            existing.editor = editor;
            existing.onDrop = onDrop;
            return;
        }
        libraryDropTargets.push({ el, editor, onDrop });
    };

    const pruneLibraryDropTargets = () => {
        for (let i = libraryDropTargets.length - 1; i >= 0; i--) {
            if (!libraryDropTargets[i].el.isConnected) libraryDropTargets.splice(i, 1);
        }
    };

    const LIBRARY_DROP_TOLERANCE_PX = 16;

    const findLibraryDropTargetAt = (x, y) => {
        for (let i = libraryDropTargets.length - 1; i >= 0; i--) {
            const t = libraryDropTargets[i];
            if (!t.el.isConnected) continue;
            const rect = t.el.getBoundingClientRect();
            if (
                x >= rect.left - LIBRARY_DROP_TOLERANCE_PX && x <= rect.right + LIBRARY_DROP_TOLERANCE_PX &&
                y >= rect.top - LIBRARY_DROP_TOLERANCE_PX && y <= rect.bottom + LIBRARY_DROP_TOLERANCE_PX
            ) {
                return t;
            }
        }
        return null;
    };

    let activeLibraryDragEl = null;
    let libraryDragHandledAt = 0;

    const onLibraryDragPointerDown = (e) => {
        const item = e.target.closest && e.target.closest('.library-item');
        activeLibraryDragEl = item || null;
    };
    document.addEventListener('mousedown', onLibraryDragPointerDown, true);
    document.addEventListener('pointerdown', onLibraryDragPointerDown, true);

    const findActiveDraggingLibraryItem = () =>
        document.querySelector('.library-item.ui-draggable-dragging, .library-item.ui-draggable-disabled.ui-draggable-dragging');

    const onLibraryDragRelease = (e) => {
        const now = Date.now();
        if (now - libraryDragHandledAt < 300) return;

        const dragEl = activeLibraryDragEl || findActiveDraggingLibraryItem();
        activeLibraryDragEl = null;
        if (!dragEl) return;

        const target = findLibraryDropTargetAt(e.clientX, e.clientY);
        if (!target) return;

        libraryDragHandledAt = now;
        e.stopImmediatePropagation();
        e.preventDefault();

        const url = extractLibraryDragUrl(dragEl);
        if (!url) {
            alert('이 항목에서 이미지 주소를 찾지 못했습니다.');
            return;
        }

        const range = getRangeFromPoint(e.clientX, e.clientY);
        insertImageAtCursor(target.editor, cleanRoll20ImageUrl(url), range);

        if (typeof target.onDrop === 'function') target.onDrop();
    };
    document.addEventListener('mouseup', onLibraryDragRelease, true);
    document.addEventListener('pointerup', onLibraryDragRelease, true);

    const enableLibraryDropOnEditors = () => {
        pruneLibraryDropTargets();
        document.querySelectorAll('.note-editable').forEach(editor => {
            registerLibraryDropTarget(editor, editor);
        });
    };

    /* [ 로컬 파일 첨부 & 이미지 첨부 팝업 UI ] */
    const readFileAsImage = (file, onDone) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => onDone(reader.result);
        reader.onerror = () => alert('이미지를 읽는 중 오류가 발생했습니다.');
        reader.readAsDataURL(file);
    };

    const triggerFileUpload = (editor, range) => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (file) {
                readFileAsImage(file, (dataUrl) => insertImageAtCursor(editor, dataUrl, range));
            }
            fileInput.remove();
        });

        document.body.appendChild(fileInput);
        fileInput.click();
    };

    const openImageInsertPopover = (editor, anchorBtn) => {
        document.getElementById('r20-img-insert-popover')?.remove();

        saveSelection();

        const rect = anchorBtn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.id = 'r20-img-insert-popover';
        pop.style.cssText = `
            position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px;
            background: #fff; border: 1px solid #ccc; border-radius: 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 999999;
            padding: 10px; width: 230px; font-family: sans-serif; font-size: 12px;
            color: #333; box-sizing: border-box;
        `;

        pop.innerHTML = `
            <label style="display:block; margin-bottom:4px; color:#555; font-weight:bold;">🔗 이미지 URL로 추가</label>
            <div style="display:flex; align-items:center; gap:4px; margin-bottom:10px;">
                <input type="text" class="r20-img-url-input" placeholder="https://..." style="flex:1; min-width:0; height:26px !important; line-height:24px !important; padding:0 6px; margin:0; border:1px solid #ccc; border-radius:3px; color:#000; background:#fff; box-sizing:border-box; font-size:12px;">
                <button type="button" class="r20-img-url-add btn btn-primary btn-sm" style="height:26px !important; line-height:24px !important; padding:0 10px; margin:0; cursor:pointer; box-sizing:border-box; float:none;">추가</button>
            </div>
            <button type="button" class="r20-img-file-attach btn btn-default btn-sm" style="display:block; width:100%; padding:8px; cursor:pointer; box-sizing:border-box; float:none; margin:0;">
                📁 파일 첨부
            </button>
        `;

        document.body.appendChild(pop);
        pop.addEventListener('mousedown', (e) => e.stopPropagation());
        const closePop = attachOutsideClickClose(pop, anchorBtn);

        pop.querySelector('.r20-img-file-attach').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closePop();
            triggerFileUpload(editor);
        });

        const urlInput = pop.querySelector('.r20-img-url-input');
        const addUrl = () => {
            const url = urlInput.value.trim();
            if (!url) return;
            insertImageAtCursor(editor, cleanRoll20ImageUrl(url));
            closePop();
        };
        pop.querySelector('.r20-img-url-add').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addUrl();
        });
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addUrl(); }
        });
        urlInput.focus();
    };

    /* [ 툴바에 글자 크기 드롭다운 삽입 - 폰트(글꼴) 지정과 달리 글자 크기는
         Roll20 저장 시 서버가 걸러내지 않고 모두에게 그대로 적용되므로
         무료 버전에도 포함한다 ] */
    const refreshFontSizeUI = () => {
        document.querySelectorAll('.custom-font-dropdown-wrapper').forEach(w => w.remove());
        injectFontSizeDropdown();
    };

    const openFontSizeSettingsPopover = (anchorBtn) => {
        document.getElementById('r20-font-settings-popover')?.remove();

        let workingSizes = JSON.parse(JSON.stringify(CUSTOM_FONT_SIZES));

        const rect = anchorBtn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.id = 'r20-font-settings-popover';
        pop.style.cssText = `
            position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px;
            background: #fff; border: 1px solid #ccc; border-radius: 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 999999;
            padding: 10px; width: 260px; font-family: sans-serif; font-size: 12px;
            color: #333; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px;
            max-height: 80vh; overflow-y: auto;
        `;

        pop.innerHTML = `
            <label style="display:block; margin:0; color:#555; font-weight:bold;">글자 크기 목록 (쉼표로 구분)</label>
            <input type="text" class="r20-fontsize-list-input" style="width:100%; height:24px; font-size:11px; padding:0 4px; border:1px solid #ccc; box-sizing:border-box; color:#000; background:#fff;" value="${workingSizes.join(', ')}">

            <div style="display:flex; gap:4px; margin-top:4px;">
                <button type="button" class="r20-font-save-btn btn btn-primary btn-sm" style="flex:1; padding:4px 0; cursor:pointer; box-sizing:border-box; margin:0;">저장</button>
                <button type="button" class="r20-font-reset-btn btn btn-default btn-sm" style="flex:1; padding:4px 0; cursor:pointer; box-sizing:border-box; margin:0;">기본값으로</button>
            </div>
        `;

        document.body.appendChild(pop);
        pop.addEventListener('mousedown', (e) => e.stopPropagation());
        const closePop = attachOutsideClickClose(pop, anchorBtn);

        pop.querySelector('.r20-font-save-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const sizesRaw = pop.querySelector('.r20-fontsize-list-input').value;
            const parsedSizes = sizesRaw.split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n) && n > 0);
            const uniqueSizes = [...new Set(parsedSizes)].sort((a, b) => a - b);

            if (uniqueSizes.length === 0) {
                alert('크기가 최소 1개는 있어야 합니다.');
                return;
            }

            CUSTOM_FONT_SIZES = uniqueSizes;
            localStorage.setItem(R20_FONT_SIZES_STORAGE_KEY, JSON.stringify(CUSTOM_FONT_SIZES));

            refreshFontSizeUI();
            closePop();
        });

        pop.querySelector('.r20-font-reset-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            workingSizes = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FONT_SIZES));
            pop.querySelector('.r20-fontsize-list-input').value = workingSizes.join(', ');
        });
    };

    const injectFontSizeDropdown = () => {
        const toolbars = document.querySelectorAll('.note-toolbar, .tox-toolbar__group');

        toolbars.forEach(toolbar => {
            if (toolbar.querySelector('.custom-font-dropdown-wrapper')) return;

            const styleBtnGroup = toolbar.querySelector('.note-style, div:has(.note-icon-magic)') || toolbar.firstElementChild;
            if (!styleBtnGroup) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'note-btn-group btn-group custom-font-dropdown-wrapper';

            wrapper.innerHTML = `
                <select class="custom-fontsize-select btn btn-default btn-sm" style="
                    height: 30px !important;
                    line-height: 20px !important;
                    width: 62px;
                    font-size: 12px;
                    padding: 3px 4px;
                    margin: 0;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    background: #ffffff;
                    color: #333333;
                    cursor: pointer;
                    outline: none;
                    box-shadow: none;
                    vertical-align: middle;
                ">
                    <option value="" disabled selected>크기</option>
                    ${CUSTOM_FONT_SIZES.map(size => `<option value="${size}px">${size}px</option>`).join('')}
                </select>
                <button type="button" class="note-btn btn btn-default btn-sm custom-font-settings-btn" title="글자 크기 목록 설정" aria-label="글자 크기 목록 설정">⚙</button>
            `;

            const sizeSelectEl = wrapper.querySelector('.custom-fontsize-select');
            sizeSelectEl.addEventListener('mousedown', () => saveSelection(), true);
            sizeSelectEl.addEventListener('pointerdown', () => saveSelection(), true);
            sizeSelectEl.addEventListener('change', (e) => {
                if (e.target.value) {
                    applyTextStyle('fontSize', e.target.value);
                }
            });

            const settingsBtn = wrapper.querySelector('.custom-font-settings-btn');
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCustomPopover('r20-font-settings-popover', () => openFontSizeSettingsPopover(settingsBtn));
            });

            styleBtnGroup.parentNode.insertBefore(wrapper, styleBtnGroup.nextSibling);
        });
    };

    /* [ 툴바 버튼 찾기 - 아이콘 클래스 또는 title/aria-label 텍스트로 기존 버튼을 검색 ] */
    const findToolbarButton = (toolbar, iconClass, textFragments) => {
        return Array.from(toolbar.querySelectorAll('button')).find(btn => {
            if (iconClass && btn.querySelector(iconClass)) return true;
            const label = (
                (btn.getAttribute('data-original-title') || '') + ' ' +
                (btn.getAttribute('title') || '') + ' ' +
                (btn.getAttribute('aria-label') || '')
            ).toLowerCase();
            return textFragments.some(t => label.includes(t));
        });
    };

    /* [ 툴바에 이미지 첨부 버튼 삽입 + 하이퍼링크 삭제 버튼을 하이퍼링크
         버튼 옆으로 이동 - 새 그룹을 따로 만들지 않고, 원래 있던 하이퍼링크
         버튼의 부모(이미 서머노트가 크기를 잡아놓은 자리) 안에 얹는 방식이라
         레이아웃이 꽉 찬 줄에서 새 그룹이 통째로 찌그러져 사라지는 문제가
         없다. 진단 로그로 확인해보니 정렬 그룹은 정확히 찾았지만 새로 만든
         그룹이 폭 0으로 찌그러졌던 것으로 보여, 새 그룹을 만드는 방식 자체를
         버렸다. 이미지 버튼은 원래 이 스크립트가 하이퍼링크 버튼 바로 앞에
         넣던 자리 그대로다(정렬 버튼 그룹 바로 다음 자리인 게 서머노트
         툴바의 기본 구성이라, 결과적으로 "정렬 옆"이 된다). ] */
    const injectQuickActionButtons = () => {
        const editorRoots = document.querySelectorAll('.note-editor, .tox-tinymce');

        editorRoots.forEach(editorRoot => {
            if (editorRoot.querySelector('.custom-img-upload-btn')) return;

            const linkBtn = findToolbarButton(editorRoot, '.note-icon-link', ['link', '링크']);
            if (!linkBtn) return;

            const getEditor = () => editorRoot.querySelector('.note-editable, .tox-edit-area');

            const imgBtn = document.createElement('button');
            imgBtn.type = 'button';
            imgBtn.className = 'note-btn btn btn-default btn-sm custom-img-upload-btn';
            imgBtn.title = '이미지 첨부';
            imgBtn.setAttribute('aria-label', '이미지 첨부');
            imgBtn.innerHTML = `<i class="note-icon-picture"></i>`;
            imgBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const editor = getEditor();
                if (!editor) { alert('에디터 영역을 찾을 수 없습니다.'); return; }
                toggleCustomPopover('r20-img-insert-popover', () => openImageInsertPopover(editor, imgBtn));
            });

            const insertGroup = linkBtn.closest('.note-insert') || linkBtn.parentNode;
            insertGroup.insertBefore(imgBtn, linkBtn);

            const unlinkBtn = findToolbarButton(editorRoot, '.note-icon-unlink, .note-icon-chain-broken', ['unlink', '링크 삭제', '링크 해제', '링크 제거']);
            if (unlinkBtn) {
                linkBtn.parentNode.insertBefore(unlinkBtn, linkBtn.nextSibling);
            }
        });
    };

    /* [ 컴퓨터/브라우저에서 표준 드래그앤드롭으로 이미지 삽입 ] */

    const handleEditorDragOver = (e) => {
        if (e.target.closest && e.target.closest('.note-editable')) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        }
    };

    const handleEditorImageDrop = (e) => {
        const editor = e.target.closest && e.target.closest('.note-editable');
        if (!editor) return;

        const dt = e.dataTransfer;
        if (!dt) return;

        const dropRange = getRangeFromPoint(e.clientX, e.clientY);

        if (dt.files && dt.files.length > 0 && dt.files[0].type.startsWith('image/')) {
            e.preventDefault();
            e.stopPropagation();
            readFileAsImage(dt.files[0], (dataUrl) => insertImageAtCursor(editor, dataUrl, dropRange));
            return;
        }

        const uriList = dt.getData('text/uri-list');
        const html = dt.getData('text/html');
        const plain = dt.getData('text/plain');

        let url = '';
        if (uriList) {
            url = uriList.split('\n').find(line => line && !line.startsWith('#')) || '';
        }
        if (!url && html) {
            const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (match) url = match[1];
        }
        if (!url && plain && /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(plain.trim())) {
            url = plain.trim();
        }

        if (url) {
            e.preventDefault();
            e.stopPropagation();
            insertImageAtCursor(editor, cleanRoll20ImageUrl(url), dropRange);
        }
    };

    /* [ 글자색/배경색 팝업에 커스텀 옵션 추가 ] */
    const enhanceColorPalette = () => {
        const colorPopups = document.querySelectorAll('.note-color .dropdown-menu, .tox-swatches-menu, .note-holder .dropdown-menu, div.dropdown-menu.note-holder-menu');

        colorPopups.forEach(popup => {
            if (popup.querySelector('.custom-color-picker-wrapper')) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'custom-color-picker-wrapper';
            wrapper.style.cssText = 'padding: 8px; border-top: 1px solid #ccc; margin-top: 5px; font-size: 11px; background: #fff; position: relative; z-index: 99999; box-sizing:border-box;';

            wrapper.innerHTML = `
                <div style="display:grid; grid-template-columns: 40px 40px 20px minmax(0, 1fr); align-items:end; gap:6px; row-gap:8px;">
                    <span class="ccpw-label">커스텀</span>
                    <input type="color" class="custom-picker-input ccpw-control" value="#ff0000" style="width:100%; padding:0; border:1px solid #ccc; cursor:pointer;">
                    <span></span>
                    <select class="custom-picker-type ccpw-control" style="width:100%; min-width:0; padding:0 2px;">
                        <option value="color">글자색</option>
                        <option value="backgroundColor">글자 배경색</option>
                        <option value="tableCellBg">표 칸 배경색</option>
                        <option value="tableCellBorder">표 칸 테두리</option>
                        <option value="hrStyle">가름줄(구분선)</option>
                    </select>

                    <div class="custom-border-row" style="display:none;">
                        <span class="ccpw-label">두께</span>
                        <input type="number" class="custom-border-width ccpw-control" value="1" min="1" max="20" style="width:100%; text-align:center; padding:0; border:1px solid #ccc; background:#fff; color:#000;">
                        <span class="ccpw-label">px</span>
                        <select class="custom-border-style ccpw-control" style="width:100%; min-width:0; padding:0 2px;">
                            <option value="solid">실선</option>
                            <option value="dashed">파선</option>
                            <option value="dotted">점선</option>
                            <option value="double">이중선</option>
                        </select>
                    </div>

                    <button type="button" class="custom-border-apply btn btn-primary btn-sm" style="grid-column: 1 / -1; width:100%; cursor:pointer; padding:5px 8px; box-sizing:border-box; margin-top:2px;">적용</button>
                </div>
            `;

            wrapper.addEventListener('mousedown', (e) => e.stopPropagation());
            wrapper.addEventListener('click', (e) => e.stopPropagation());

            const colorInput = wrapper.querySelector('.custom-picker-input');
            const typeSelect = wrapper.querySelector('.custom-picker-type');
            const borderRow = wrapper.querySelector('.custom-border-row');
            const borderWidthInput = wrapper.querySelector('.custom-border-width');
            const borderStyleSelect = wrapper.querySelector('.custom-border-style');

            const usesBorderOptions = () => typeSelect.value === 'tableCellBorder' || typeSelect.value === 'hrStyle';

            typeSelect.addEventListener('change', () => {
                borderRow.style.display = usesBorderOptions() ? 'contents' : 'none';
            });

            const applyByType = (color) => {
                if (typeSelect.value === 'tableCellBg') {
                    applyTableCellBackground(color);
                } else if (typeSelect.value === 'tableCellBorder') {
                    applyTableCellBorder(color, borderWidthInput.value, borderStyleSelect.value);
                } else if (typeSelect.value === 'hrStyle') {
                    applyHrStyle(color, borderWidthInput.value, borderStyleSelect.value);
                } else {
                    applyTextStyle(typeSelect.value, color);
                }
            };

            colorInput.addEventListener('change', (e) => applyByType(e.target.value));

            wrapper.querySelector('.custom-border-apply').addEventListener('click', (e) => {
                e.preventDefault();
                applyByType(colorInput.value);
            });

            popup.appendChild(wrapper);
        });
    };

    /* [ 팝업/드롭다운 위치 보정 - 화면·다이얼로그 밖으로 잘리지 않게 ] */

    const positionFixedDropdown = (menu, toggleBtn) => {
        if (!menu || !toggleBtn) return;

        menu.style.width = 'max-content';
        menu.style.maxWidth = '95vw';

        menu.style.position = 'fixed';
        menu.style.zIndex = '999999';
        menu.style.margin = '0';
        menu.style.right = 'auto';
        menu.style.bottom = 'auto';

        const btnRect = toggleBtn.getBoundingClientRect();
        menu.style.top = (btnRect.bottom + 4) + 'px';
        menu.style.left = btnRect.left + 'px';

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            const margin = 8;
            let left = btnRect.left;

            if (menuRect.right > window.innerWidth - margin) {
                left = window.innerWidth - margin - menuRect.width;
            }
            if (left < margin) left = margin;
            menu.style.left = left + 'px';

            if (menuRect.bottom > window.innerHeight - margin) {
                const top = Math.max(margin, btnRect.top - menuRect.height - 4);
                menu.style.top = top + 'px';
            }
        });
    };

    const fixColorDropdownClipping = () => {
        const openPopups = document.querySelectorAll(
            '.note-color .dropdown-menu, .tox-swatches-menu, .note-holder .dropdown-menu, div.dropdown-menu.note-holder-menu'
        );

        openPopups.forEach(menu => {
            if (menu.offsetParent === null && menu.style.position !== 'fixed') return;
            if (getComputedStyle(menu).display === 'none') return;

            const group = menu.closest('.btn-group, .dropdown') || menu.parentNode;
            const toggleBtn = group ? group.querySelector('.dropdown-toggle') : null;
            if (!toggleBtn) return;

            positionFixedDropdown(menu, toggleBtn);
        });
    };

    /* [ 부트스트랩 툴팁 잔상 제거 ] */
    const cleanupStrayTooltips = () => {
        document.querySelectorAll('.tooltip').forEach(tip => {
            const owner = tip.id ? document.querySelector(`[aria-describedby="${tip.id}"]`) : null;
            if (!owner || !owner.matches(':hover')) {
                tip.remove();
            }
        });
    };

    /* [ 표 삽입 크기 선택 팝업에 너비/정렬 옵션 추가 ] */
    const enhanceTableMenu = () => {
        const tablePopups = document.querySelectorAll([
            '.note-table .dropdown-menu',
            '.note-popover .dropdown-menu',
            '.note-holder-table-menu',
            '.note-dimension-picker',
            '.dropdown-menu:has(.note-dimension-picker)'
        ].join(','));

        tablePopups.forEach(popup => {
            const targetContainer = popup.classList.contains('dropdown-menu') ? popup : popup.closest('.dropdown-menu') || popup;
            if (!targetContainer || targetContainer.querySelector('.custom-table-options')) return;

            const optionsDiv = document.createElement('div');
            optionsDiv.className = 'custom-table-options';
            optionsDiv.style.cssText = 'padding: 8px; border-top: 1px solid #ccc; margin-top: 5px; font-size: 11px; background: #fff; position: relative; z-index: 99999; width: 100%; box-sizing: border-box;';

            optionsDiv.innerHTML = `
                <div style="margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
                    <label style="margin:0; color:#333; font-weight:bold; font-size:11px;">너비(px):</label>
                    <input type="text" class="custom-table-width" value="400" placeholder="예: 400" style="width: 60px; height: 20px; font-size: 11px; text-align: center; padding: 0; border: 1px solid #ccc; background:#fff; color:#000;">
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <label style="margin:0; color:#333; font-weight:bold; font-size:11px;">정렬:</label>
                    <select class="custom-table-align" style="height: 20px; font-size: 11px; padding: 0 2px; background:#fff; color:#000;">
                        <option value="center">가운데</option>
                        <option value="left">왼쪽</option>
                        <option value="right">오른쪽</option>
                    </select>
                </div>
            `;

            ['mousedown', 'click', 'mouseup', 'change'].forEach(type => {
                optionsDiv.addEventListener(type, (e) => e.stopPropagation());
            });

            targetContainer.appendChild(optionsDiv);

            targetContainer.addEventListener('mousedown', (e) => {
                const isDimensionCell = e.target.closest('.note-dimension-picker-unselected, .note-dimension-picker-mouseover, .note-dimension-picker-mousecatcher, .note-dimension-picker');
                if (!isDimensionCell) return;

                let widthInput = optionsDiv.querySelector('.custom-table-width').value.trim() || '400';
                const widthNum = parseInt(widthInput, 10);
                if (!isNaN(widthInput)) {
                    widthInput += 'px';
                }

                const alignVal = optionsDiv.querySelector('.custom-table-align').value || 'center';

                const editorRoot = (targetContainer.closest('.note-editor, .tox-tinymce') || popup.closest('.note-editor, .tox-tinymce'))
                    ?.querySelector('.note-editable, .tox-edit-area');

                const scopeBeforeClick = editorRoot || document;
                const existingTables = new Set(scopeBeforeClick.querySelectorAll('table'));

                let attempts = 0;
                const checkAndApplyTable = setInterval(() => {
                    attempts++;
                    const scope = editorRoot || document;
                    const tables = Array.from(scope.querySelectorAll('table'));
                    const newTable = tables.find(t => !existingTables.has(t) && !t.dataset.customStyled);

                    if (newTable) {
                        newTable.dataset.customStyled = 'true';
                        newTable.style.setProperty('width', widthInput, 'important');
                        newTable.style.setProperty('max-width', 'none', 'important');
                        if (!isNaN(widthNum)) newTable.setAttribute('width', String(widthNum));

                        if (alignVal === 'center') {
                            newTable.style.marginLeft = 'auto';
                            newTable.style.marginRight = 'auto';
                        } else if (alignVal === 'right') {
                            newTable.style.marginLeft = 'auto';
                            newTable.style.marginRight = '0';
                        } else {
                            newTable.style.marginLeft = '0';
                            newTable.style.marginRight = 'auto';
                        }
                        clearInterval(checkAndApplyTable);
                    }

                    if (attempts > 50) {
                        console.warn('[R20-Custom-Editor] 표 너비 적용 실패: 5초 안에 새로 생긴 표를 못 찾았습니다.');
                        clearInterval(checkAndApplyTable);
                    }
                }, 100);
            }, true);
        });
    };

    /* [ 공통 유틸 - 항목 다중 선택 & 삭제 컨트롤러 ] */
    const hideD20ContextMenu = (fromEl) => {
        const menu = fromEl.closest('.d20contextmenu');
        if (menu) menu.style.display = 'none';
    };

    const createMultiSelectController = (config) => {
        const selectedIds = new Set();
        let lastAnchorId = null;

        const getOrderedIds = () => Array.from(document.querySelectorAll(config.itemSelector))
            .map(el => el.dataset[config.idAttr])
            .filter(Boolean);

        const syncStyles = () => {
            if (selectedIds.size === 0) return;
            document.querySelectorAll(config.itemSelector).forEach(item => {
                const nameEl = item.querySelector(config.nameSelector);
                if (!nameEl) return;
                if (selectedIds.has(item.dataset[config.idAttr])) {
                    nameEl.classList.add('r20-journal-selected-name');
                } else {
                    nameEl.classList.remove('r20-journal-selected-name');
                }
            });
        };

        const clearSelection = () => {
            lastAnchorId = null;
            if (selectedIds.size === 0) return;
            selectedIds.clear();
            syncStyles();
        };

        const selectRange = (anchorId, targetId) => {
            const ids = getOrderedIds();
            const anchorIdx = ids.indexOf(anchorId);
            const targetIdx = ids.indexOf(targetId);
            if (anchorIdx === -1 || targetIdx === -1) return;

            const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
            for (let i = start; i <= end; i++) {
                if (!config.getModel || config.getModel(ids[i])) selectedIds.add(ids[i]);
            }
            syncStyles();
        };

        const toggleSelection = (item) => {
            const id = item.dataset[config.idAttr];
            if (!id) return;
            if (config.getModel && !config.getModel(id)) return;

            if (selectedIds.has(id)) {
                selectedIds.delete(id);
            } else {
                selectedIds.add(id);
            }
            syncStyles();
        };

        return {
            selectedIds,
            getLastAnchorId: () => lastAnchorId,
            setLastAnchorId: (id) => { lastAnchorId = id; },
            getOrderedIds, syncStyles, clearSelection, selectRange, toggleSelection,
        };
    };

    const registerMultiSelectEvents = (config) => {
        const { controller, itemSelector, idAttr, getModel, deleteItemSelector, deleteAction, clearAllowSelector, injectDeleteMenuItem } = config;

        const handleCtrlInteraction = (e) => {
            if (!(e.ctrlKey || e.metaKey)) return false;
            const item = e.target.closest(itemSelector);
            if (!item) return false;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return item;
        };

        let ctrlMousedownHandled = false;

        document.addEventListener('mousedown', (e) => {
            const deleteItem = e.target.closest(deleteItemSelector);
            if (deleteItem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                deleteAction();
                hideD20ContextMenu(deleteItem);
                return;
            }

            const item = handleCtrlInteraction(e);
            if (item) {
                const id = item.dataset[idAttr];
                const anchorId = controller.getLastAnchorId();
                if (e.shiftKey && anchorId) {
                    controller.selectRange(anchorId, id);
                } else {
                    controller.toggleSelection(item);
                    controller.setLastAnchorId(id);
                }
                ctrlMousedownHandled = true;
            }
        }, true);

        document.addEventListener('click', (e) => {
            if (ctrlMousedownHandled) {
                ctrlMousedownHandled = false;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }

            if (handleCtrlInteraction(e)) return;

            const item = e.target.closest(itemSelector);
            if (item && (e.ctrlKey || e.metaKey)) return;

            if (controller.selectedIds.size > 0 && !e.target.closest(clearAllowSelector)) {
                controller.clearSelection();
            }
        }, true);

        document.addEventListener('contextmenu', (e) => {
            const item = e.target.closest(itemSelector);
            const id = item ? item.dataset[idAttr] : null;

            if (!item && controller.selectedIds.size === 0) return;

            if (id && (!getModel || getModel(id)) && !controller.selectedIds.has(id)) {
                controller.selectedIds.clear();
                controller.selectedIds.add(id);
                controller.syncStyles();
            }

            setTimeout(injectDeleteMenuItem, 0);
        }, true);
    };

    /* [ 핸드아웃 · 캐릭터 다중 선택 & 삭제 ] */
    const JOURNAL_ITEM_SELECTOR = 'li.journalitem[data-itemid], li.nj-item[data-itemid]';
    const JOURNAL_NAME_SELECTOR = '.namecontainer, .nj-name';

    const getHandoutModel = (id) => {
        if (!id || !window.Campaign) return null;
        const handouts = window.Campaign.handouts;
        const characters = window.Campaign.characters;
        const fromHandouts = handouts && handouts.get(id);
        if (fromHandouts) return fromHandouts;
        const fromCharacters = characters && characters.get(id);
        if (fromCharacters) return fromCharacters;
        return null;
    };

    const journalSelect = createMultiSelectController({
        itemSelector: JOURNAL_ITEM_SELECTOR,
        nameSelector: JOURNAL_NAME_SELECTOR,
        idAttr: 'itemid',
        getModel: getHandoutModel,
    });

    const deleteSelectedHandouts = () => {
        if (journalSelect.selectedIds.size === 0) return;

        const targets = Array.from(journalSelect.selectedIds);

        const names = targets.map(id => {
            const model = getHandoutModel(id);
            return model ? (model.get('name') || '(제목 없음)') : id;
        });

        const confirmed = window.confirm(`선택한 항목 ${targets.length}개를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.\n\n${names.join('\n')}`);
        if (!confirmed) return;

        targets.forEach(id => {
            const model = getHandoutModel(id);
            if (model) model.destroy();
        });

        journalSelect.clearSelection();
    };

    const injectJournalDeleteMenuItem = () => {
        const legacyMenu = document.getElementById('journalitemmenu');
        const newMenu = document.getElementById('journal-context-menu');
        const menu = legacyMenu || newMenu;
        if (!menu) return;

        const container = legacyMenu ? menu.querySelector('ul') : menu;
        if (!container) return;

        let deleteItem = container.querySelector('.r20-custom-delete-item');

        if (journalSelect.selectedIds.size === 0) {
            if (deleteItem) deleteItem.remove();
            return;
        }

        if (!deleteItem) {
            deleteItem = document.createElement(legacyMenu ? 'li' : 'div');
            deleteItem.className = legacyMenu ? 'r20-custom-delete-item' : 'context-menu-item r20-custom-delete-item';
            container.appendChild(deleteItem);
        }

        deleteItem.textContent = `선택한 ${journalSelect.selectedIds.size}개 일괄 삭제`;
    };

    /* [ 라이브러리 이미지 다중 선택 & 삭제 ] */
    const LIBRARY_ITEM_SELECTOR = 'li[data-imageid]';
    const LIBRARY_NAME_SELECTOR = '.namecontainer';

    const librarySelect = createMultiSelectController({
        itemSelector: LIBRARY_ITEM_SELECTOR,
        nameSelector: LIBRARY_NAME_SELECTOR,
        idAttr: 'imageid',
        getModel: null,
    });

    const deleteSelectedImages = () => {
        if (librarySelect.selectedIds.size === 0) return;

        const targets = Array.from(librarySelect.selectedIds);

        const confirmed = window.confirm(`선택한 이미지 ${targets.length}개를 라이브러리에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없고, 이미지 자체가 영구 삭제됩니다.`);
        if (!confirmed) return;

        const finishUp = () => {
            targets.forEach(id => {
                document.querySelectorAll(`li[data-imageid="${id}"]`).forEach(el => el.remove());
            });
            librarySelect.clearSelection();
        };

        const failUp = (err) => {
            console.error('[R20-Custom-Editor] 이미지 삭제 요청 실패', err);
            alert('이미지 삭제 요청이 실패했습니다. 콘솔(F12)을 확인해주세요.');
        };

        const $ = window.jQuery || window.$;
        if ($ && typeof $.post === 'function') {
            $.post('/image_library/permdelete', { ids: { imageids: targets } })
                .done(finishUp)
                .fail(failUp);
        } else {
            const params = new URLSearchParams();
            targets.forEach(id => params.append('ids[imageids][]', id));
            fetch('https://app.roll20.net/image_library/permdelete', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: params.toString(),
            }).then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                finishUp();
            }).catch(failUp);
        }
    };

    const injectLibraryDeleteMenuItem = () => {
        const menu = document.getElementById('librarycopymenu');
        if (!menu) return;

        const container = menu.querySelector('ul');
        if (!container) return;

        let deleteItem = container.querySelector('.r20-custom-image-delete-item');

        if (librarySelect.selectedIds.size === 0) {
            if (deleteItem) deleteItem.remove();
            return;
        }

        if (!deleteItem) {
            deleteItem = document.createElement('li');
            deleteItem.className = 'r20-custom-image-delete-item';
            container.appendChild(deleteItem);
        }

        deleteItem.textContent = `선택한 ${librarySelect.selectedIds.size}개 이미지 일괄 삭제`;
    };

    /* [ 전역 이벤트 등록 & 개선 기능 일괄 실행 루프 ] */
    document.addEventListener('selectionchange', () => {
        updateTableCellHighlight();

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const editor = getEditorFromNode(range.commonAncestorContainer);
        if (!editor) return;

        saveSelection();
    });

    document.addEventListener('paste', handlePasteFormatting, true);
    document.addEventListener('dragover', handleEditorDragOver, true);
    document.addEventListener('drop', handleEditorImageDrop, true);

    registerMultiSelectEvents({
        controller: journalSelect,
        itemSelector: JOURNAL_ITEM_SELECTOR,
        idAttr: 'itemid',
        getModel: getHandoutModel,
        deleteItemSelector: '.r20-custom-delete-item',
        deleteAction: deleteSelectedHandouts,
        clearAllowSelector: '.r20-custom-delete-item, #journal-context-menu',
        injectDeleteMenuItem: injectJournalDeleteMenuItem,
    });

    registerMultiSelectEvents({
        controller: librarySelect,
        itemSelector: LIBRARY_ITEM_SELECTOR,
        idAttr: 'imageid',
        getModel: null,
        deleteItemSelector: '.r20-custom-image-delete-item',
        deleteAction: deleteSelectedImages,
        clearAllowSelector: '.r20-custom-image-delete-item, #librarycopymenu',
        injectDeleteMenuItem: injectLibraryDeleteMenuItem,
    });

    const runEnhancer = () => {
        cleanupLegacyDisplayBake();
        forceInjectLabelDOM();
        injectFontSizeDropdown();
        injectQuickActionButtons();
        enableLibraryDropOnEditors();
        injectTemplateButtons();
        injectTableMergeSplitButtons();
        injectHrInsertButton();
        enhanceColorPalette();
        fixColorDropdownClipping();
        cleanupStrayTooltips();
        enhanceTableMenu();
        makeTablesResizable();
        fixInvalidInlineWrapping();
        normalizeTableAlignment();
        journalSelect.syncStyles();
        librarySelect.syncStyles();
    };

    document.addEventListener('click', (e) => {
        const targetImg = e.target.closest('.handoutviewer img, .dialog:not(.editing) .note-editable img');
        const parentLink = e.target.closest('a');

        if (targetImg && targetImg.src && !targetImg.closest('.avatar')) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            openLightbox(targetImg.src);
            return false;
        }

        if (parentLink && parentLink.querySelector('img')) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }

        if (r20FontSyncInFlight.size === 0) {
            requestAnimationFrame(runEnhancer);
        }
    }, true);

    setInterval(() => {

        if (r20FontSyncInFlight.size === 0) runEnhancer();
    }, 1000);

    const R20_MUTATION_WATCH_EXCLUDE_SELECTOR = '#textchat, #editor-wrapper';

    let disconnectCheckTimer = null;
    const scheduleDisconnectCheck = () => {
        clearTimeout(disconnectCheckTimer);
        disconnectCheckTimer = setTimeout(() => {
            if (r20FontSyncInFlight.size > 0) {
                scheduleDisconnectCheck();
                return;
            }
            lastKnownEditorContent.forEach((entry, editorEl) => {
                if (!editorEl.isConnected) {
                    lastKnownEditorContent.delete(editorEl);
                    syncFontStyledContentToServer(entry.handoutId, entry.field, entry.html);
                }
            });
        }, 3000);
    };

    let mutationDebounceTimer = null;
    const observer = new MutationObserver((mutationsList) => {
        const hasRelevantChange = mutationsList.some(m =>
            !(m.target.closest && m.target.closest(R20_MUTATION_WATCH_EXCLUDE_SELECTOR))
        );
        if (!hasRelevantChange) return;

        scheduleDisconnectCheck();

        clearTimeout(mutationDebounceTimer);
        if (r20FontSyncInFlight.size > 0) return;

        mutationDebounceTimer = setTimeout(() => {
            runEnhancer();
        }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
