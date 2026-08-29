// ==UserScript==
// @name         Roll20 Custom Handout Editer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @author       오골계 (https://x.com/5golgyeo)
// @description  기존의 핸드아웃 편집창에 몇 가지 기능을 추가하고 오류를 수정했습니다. (지원 기능: 본문 이미지 첨부(URL 입력/파일 선택/드래그앤드롭/라이브러리 드래그 지원), 폰트와 크기 지정, 색상 선택 기능 추가, 표 너비·높이·정렬 변경, 표 칸 배경색·테두리 지정, 표 칸 합치기·나누기, 가름줄(구분선) 색상·두께·모양 변경, 템플릿 저장·불러오기(실제 내용 미리보기 지원), 구글 문서 붙여넣을 시 양식 깨지는 오류 수정)
// @match        https://app.roll20.net/editor/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Custom%20Handout%20Editer.js
// @downloadURL  https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Custom%20Handout%20Editer.js
// ==/UserScript==

/* ==========================================================================
   [ 폰트 설정 영역 ]
   ========================================================================== */
const CUSTOM_FONTS = [
    { name: '기본 폰트', url: '', family: 'inherit' },
    { name: '나눔고딕', url: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap', family: "'Nanum Gothic', sans-serif" },
    { name: '나눔명조', url: 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap', family: "'Nanum Myeongjo', serif" },
    { name: 'Gmarket Sans', url: 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/GmarketSansMedium.woff', family: 'GmarketSansMedium' },
    { name: 'Pretendard', url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css', family: 'Pretendard' }
];

(function() {
    'use strict';

    if (!document.getElementById('r20-custom-style-v30')) {
        const style = document.createElement('style');
        style.id = 'r20-custom-style-v30';
        style.innerHTML = `
            .handoutviewer .avatar,
            .handoutviewer img.avatar {
                display: none !important;
                height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
            }

            .r20-custom-lightbox-img {
                cursor: pointer !important;
            }

            .note-editable table {
                table-layout: fixed !important;
            }
            .note-editable td, .note-editable th {
                position: relative;
                word-break: break-all;
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
        `;
        document.head.appendChild(style);
    }

    /* ==========================================================================
       [ 공통 유틸 - 선택영역(커서) 저장/복원 ]
       ========================================================================== */
    let savedRange = null;

    const saveSelection = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            savedRange = selection.getRangeAt(0).cloneRange();
        }
    };

    const restoreSelection = () => {
        const selection = window.getSelection();
        if (savedRange && selection) {
            selection.removeAllRanges();
            selection.addRange(savedRange);
        }
    };

    /* ==========================================================================
       [ 가름줄(<hr>) 선택 상태 추적 ]
       ========================================================================== */
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

    /* ==========================================================================
       [ 웹폰트 로드 ]
       ========================================================================== */
    const loadWebFonts = () => {
        CUSTOM_FONTS.forEach(font => {
            if (font.url && !document.querySelector(`link[href="${font.url}"], style[data-font="${font.name}"]`)) {
                if (font.url.endsWith('.woff') || font.url.endsWith('.woff2') || font.url.endsWith('.ttf')) {
                    const style = document.createElement('style');
                    style.dataset.font = font.name;
                    style.innerHTML = `@font-face { font-family: '${font.family}'; src: url('${font.url}') format('woff'); font-weight: normal; font-style: normal; }`;
                    document.head.appendChild(style);
                } else {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = font.url;
                    document.head.appendChild(link);
                }
            }
        });
    };

    /* ==========================================================================
       [ 붙여넣기 시 서식 정리 ]
       ========================================================================== */
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

            const processedHtml = doc.body.innerHTML;
            document.execCommand('insertHTML', false, processedHtml);
        }
    };

    /* ==========================================================================
       [ 텍스트 스타일 적용 - 글자색/글자 배경색/폰트 공통 ]
       ========================================================================== */
    const applyTextStyle = (styleProperty, value) => {
        restoreSelection();
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);

        if (!selection.isCollapsed) {
            const span = document.createElement('span');
            span.style[styleProperty] = value;
            span.appendChild(range.extractContents());
            range.insertNode(span);
        } else {
            const span = document.createElement('span');
            span.style[styleProperty] = value;
            span.innerHTML = '&#8203;';
            range.insertNode(span);

            const newRange = document.createRange();
            newRange.setStart(span, 1);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }
    };

    /* ==========================================================================
       [ 표(테이블) 칸 격자 계산 & 드래그 다중 선택 감지 ]
       ========================================================================== */

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

    /* ==========================================================================
       [ 표 칸 합치기 / 나누기 ]
       ========================================================================== */

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
    };

    /* ==========================================================================
       [ 표 칸 배경색 / 테두리, 가름줄 스타일 적용 ]
       ========================================================================== */

    const applyTableCellBackground = (color) => {
        restoreSelection();
        const cells = getSelectedTableCells();

        if (cells.length === 0) {
            alert('표의 칸 안에 커서를 놓거나, 칸을 드래그로 선택한 다음 다시 시도해주세요.');
            return;
        }
        cells.forEach(cell => { cell.style.backgroundColor = color; });
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

    /* ==========================================================================
       [ 가름줄(구분선) 삽입 팝업 UI ]
       ========================================================================== */

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
                <input type="color" class="r20-hr-color" value="#cccccc" style="width: 26px; height: 24px; padding: 0; border: 1px solid #ccc; cursor: pointer; flex-shrink:0;">
                <input type="number" class="r20-hr-width" value="1" min="1" max="20" style="width: 38px; height: 24px; font-size: 11px; text-align:center; padding:0; border:1px solid #ccc; background:#fff; color:#000; flex-shrink:0; box-sizing:border-box;">
                <span style="flex-shrink:0;">px</span>
                <select class="r20-hr-style" style="flex:1; min-width:0; height: 24px; font-size: 11px; padding: 0 2px; box-sizing:border-box;">
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

        const closeOnOutsideClick = (ev) => {
            if (!pop.contains(ev.target) && ev.target !== anchorBtn) {
                pop.remove();
                document.removeEventListener('click', closeOnOutsideClick, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);

        pop.querySelector('.r20-hr-insert-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const color = pop.querySelector('.r20-hr-color').value;
            const width = pop.querySelector('.r20-hr-width').value;
            const style = pop.querySelector('.r20-hr-style').value;

            insertStyledHr(editor, color, width, style);
            pop.remove();
            document.removeEventListener('click', closeOnOutsideClick, true);
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

                openHrInsertPopover(editor, freshBtn);
            });
        });
    };

    /* ==========================================================================
       [ 이미지 URL 정리 & 라이트박스(확대보기) ]
       ========================================================================== */
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

    /* ==========================================================================
       [ 표 크기 조절 - 열 너비 / 행 높이 드래그 ]
       ========================================================================== */
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

    /* ==========================================================================
       [ 아바타(핸드아웃 대표 이미지) 자리에 "미리보기 아이콘" 라벨 표시 ]
       ========================================================================== */
    const forceInjectLabelDOM = () => {
        document.querySelectorAll('.avatar.dropbox').forEach(target => {
            if (target.parentNode && target.parentNode.querySelector('.r20-real-preview-label')) return;

            const label = document.createElement('div');
            label.className = 'r20-real-preview-label';
            label.textContent = '미리보기 아이콘';

            target.parentNode.insertBefore(label, target);
        });
    };

    /* ==========================================================================
       [ 템플릿 저장/관리 - localStorage 데이터 입출력 ]
       ========================================================================== */
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

    /* ==========================================================================
       [ 템플릿 저장 팝업 UI ]
       ========================================================================== */

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

        const closeOnOutsideClick = (ev) => {
            if (!pop.contains(ev.target) && ev.target !== anchorBtn) {
                pop.remove();
                document.removeEventListener('click', closeOnOutsideClick, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);

        const nameInput = pop.querySelector('.r20-tm-save-name');
        const doSave = () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }

            const templates = getTemplates();
            templates.push({ id: Date.now().toString(), name, html: content });
            saveTemplates(templates);
            pop.remove();
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

    /* ==========================================================================
       [ 템플릿 관리 / 불러오기 모달 UI ]
       ========================================================================== */

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
                        modal.remove();
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

        modal.querySelector('#r20-tm-close').addEventListener('click', () => modal.remove());

        const closeOnOutsideClick = (ev) => {
            if (!modal.contains(ev.target) && ev.target !== anchorBtn) {
                modal.remove();
                document.removeEventListener('click', closeOnOutsideClick, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);

        renderList();
    };

    /* ==========================================================================
       [ 툴바 버튼 삽입 - 템플릿 저장/불러오기, 표 칸 합치기/나누기 ]
       ========================================================================== */
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

                openTemplateSavePopover(editor, saveBtn);
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

                openTemplateManagerModal(editor, loadBtn);
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
            if (toolbar.querySelector('.custom-table-mergesplit-btn-group')) return;

            const rowDeleteBtn = toolbar.querySelector('button:has(.note-icon-row-remove), button[title*="Delete row"], button[data-original-title*="Delete row"], button[aria-label*="Delete row"]');
            if (!rowDeleteBtn) return;

            const btnWrapper = document.createElement('div');
            btnWrapper.className = 'note-btn-group btn-group custom-table-mergesplit-btn-group';

            const mergeBtn = document.createElement('button');
            mergeBtn.type = 'button';
            mergeBtn.className = 'note-btn btn btn-default btn-sm';
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
            splitBtn.className = 'note-btn btn btn-default btn-sm';
            splitBtn.title = '칸 나누기 (합쳐진 칸 안에 커서를 놓고 클릭)';
            splitBtn.setAttribute('aria-label', '칸 나누기');
            splitBtn.innerHTML = `✂️`;

            splitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                splitSelectedTableCell();
            });

            btnWrapper.appendChild(mergeBtn);
            btnWrapper.appendChild(splitBtn);

            const deleteGroup = rowDeleteBtn.closest('.btn-group') || rowDeleteBtn;
            deleteGroup.parentNode.insertBefore(btnWrapper, deleteGroup);
        });
    };

    /* ==========================================================================
       [ 이미지 삽입 공통 유틸 ]
       ========================================================================== */

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

    /* ==========================================================================
       [ 롤20 "아트 라이브러리" 항목을 드래그해서 편집창에 이미지 삽입 ]
       ========================================================================== */

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

    /* ==========================================================================
       [ 로컬 파일 첨부 & 이미지 첨부 팝업 UI ]
       ========================================================================== */
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

        const rect = anchorBtn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.id = 'r20-img-insert-popover';
        pop.style.cssText = `
            position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px;
            background: #fff; border: 1px solid #ccc; border-radius: 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 999999;
            padding: 10px; width: 230px; font-family: sans-serif; font-size: 12px;
            color: #333;
        `;

        pop.innerHTML = `
            <label style="display:block; margin-bottom:4px; color:#555; font-weight:bold;">🔗 이미지 URL로 추가</label>
            <div style="display:flex; gap:4px; margin-bottom:10px;">
                <input type="text" class="r20-img-url-input" placeholder="https://..." style="flex:1; min-width:0; padding:3px 5px; border:1px solid #ccc; border-radius:3px; color:#000; background:#fff;">
                <button type="button" class="r20-img-url-add btn btn-primary btn-sm" style="cursor:pointer;">추가</button>
            </div>
            <button type="button" class="r20-img-file-attach btn btn-default btn-sm" style="width:100%; padding:8px; cursor:pointer;">
                📁 파일 첨부
            </button>
        `;

        document.body.appendChild(pop);
        pop.addEventListener('mousedown', (e) => e.stopPropagation());

        const closeOnOutsideClick = (ev) => {
            if (!pop.contains(ev.target) && ev.target !== anchorBtn) {
                pop.remove();
                document.removeEventListener('click', closeOnOutsideClick, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);

        pop.querySelector('.r20-img-file-attach').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pop.remove();
            triggerFileUpload(editor);
        });

        const urlInput = pop.querySelector('.r20-img-url-input');
        const addUrl = () => {
            const url = urlInput.value.trim();
            if (!url) return;
            insertImageAtCursor(editor, cleanRoll20ImageUrl(url));
            pop.remove();
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

    const injectImageUploadButton = () => {
        const toolbars = document.querySelectorAll('.note-toolbar, .tox-toolbar__group');

        toolbars.forEach(toolbar => {
            if (toolbar.querySelector('.custom-img-upload-btn')) return;

            const linkBtn = Array.from(toolbar.querySelectorAll('button')).find(btn =>
                btn.querySelector('.note-icon-link') ||
                (btn.getAttribute('data-original-title') || '').toLowerCase().includes('link') ||
                (btn.getAttribute('title') || '').toLowerCase().includes('link')
            );
            if (!linkBtn) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'note-btn-group btn-group custom-img-upload-btn';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'note-btn btn btn-default btn-sm';
            btn.title = '이미지 첨부';
            btn.setAttribute('aria-label', '이미지 첨부');
            btn.innerHTML = `<i class="note-icon-picture"></i>`;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const editor = toolbar.closest('.note-editor, .tox-tinymce')?.querySelector('.note-editable, .tox-edit-area');
                if (!editor) {
                    alert('에디터 영역을 찾을 수 없습니다.');
                    return;
                }

                openImageInsertPopover(editor, btn);
            });

            wrapper.appendChild(btn);

            const insertGroup = linkBtn.closest('.note-insert') || linkBtn.parentNode;
            insertGroup.insertBefore(wrapper, linkBtn);
        });
    };

    /* ==========================================================================
       [ 컴퓨터/브라우저에서 표준 드래그앤드롭으로 이미지 삽입 ]
       ========================================================================== */

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

    /* ==========================================================================
       [ 툴바에 폰트 선택 드롭다운 삽입 ]
       ========================================================================== */
    const injectFontDropdown = () => {
        const toolbars = document.querySelectorAll('.note-toolbar, .tox-toolbar__group');

        toolbars.forEach(toolbar => {
            if (toolbar.querySelector('.custom-font-dropdown-wrapper')) return;

            const styleBtnGroup = toolbar.querySelector('.note-style, div:has(.note-icon-magic)') || toolbar.firstElementChild;
            if (!styleBtnGroup) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'note-btn-group btn-group custom-font-dropdown-wrapper';

            let optionsHTML = CUSTOM_FONTS.map(font =>
                `<option value="${font.family}" style="font-family: ${font.family};">${font.name}</option>`
            ).join('');

            wrapper.innerHTML = `
                <select class="custom-font-select btn btn-default btn-sm" style="
                    height: 30px !important;
                    line-height: 20px !important;
                    max-width: 100px;
                    font-size: 12px;
                    padding: 3px 6px;
                    margin: 0;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    background: #ffffff;
                    color: #333333;
                    cursor: pointer;
                    text-overflow: ellipsis;
                    outline: none;
                    box-shadow: none;
                    vertical-align: middle;
                ">
                    <option value="" disabled selected>폰트 선택</option>
                    ${optionsHTML}
                </select>
            `;

            const selectEl = wrapper.querySelector('.custom-font-select');
            selectEl.addEventListener('change', (e) => {
                if (e.target.value) {
                    applyTextStyle('fontFamily', e.target.value);
                }
            });

            styleBtnGroup.parentNode.insertBefore(wrapper, styleBtnGroup.nextSibling);
        });
    };

    /* ==========================================================================
       [ 글자색/배경색 팝업에 커스텀 옵션 추가 ]
       ========================================================================== */
    const enhanceColorPalette = () => {
        const colorPopups = document.querySelectorAll('.note-color .dropdown-menu, .tox-swatches-menu, .note-holder .dropdown-menu, div.dropdown-menu.note-holder-menu');

        colorPopups.forEach(popup => {
            if (popup.querySelector('.custom-color-picker-wrapper')) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'custom-color-picker-wrapper';
            wrapper.style.cssText = 'padding: 8px; border-top: 1px solid #ccc; margin-top: 5px; font-size: 11px; background: #fff; position: relative; z-index: 99999;';

            wrapper.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <span style="color:#333; font-weight:bold;">🎨 커스텀:</span>
                    <input type="color" class="custom-picker-input" value="#ff0000" style="width: 26px; height: 22px; padding: 0; border: 1px solid #ccc; cursor: pointer; vertical-align: middle;">
                    <select class="custom-picker-type" style="height: 22px; font-size: 11px; padding: 0 2px;">
                        <option value="color">글자색</option>
                        <option value="backgroundColor">글자 배경색</option>
                        <option value="tableCellBg">표 칸 배경색</option>
                        <option value="tableCellBorder">표 칸 테두리</option>
                        <option value="hrStyle">가름줄(구분선)</option>
                    </select>
                </div>
                <div class="custom-border-options" style="display:none; align-items:center; justify-content:flex-end; gap:4px; margin-top:6px;">
                    <label style="margin:0; color:#333;">두께</label>
                    <input type="number" class="custom-border-width" value="1" min="1" max="20" style="width: 36px; height: 20px; font-size: 11px; text-align:center; padding:0; border:1px solid #ccc; background:#fff; color:#000;">
                    <span>px</span>
                    <select class="custom-border-style" style="height: 20px; font-size: 11px; padding: 0 2px;">
                        <option value="solid">실선</option>
                        <option value="dashed">파선</option>
                        <option value="dotted">점선</option>
                        <option value="double">이중선</option>
                    </select>
                    <button type="button" class="custom-border-apply btn btn-primary btn-sm" style="cursor:pointer; padding:2px 8px;">적용</button>
                </div>
            `;

            wrapper.addEventListener('mousedown', (e) => e.stopPropagation());
            wrapper.addEventListener('click', (e) => e.stopPropagation());

            const colorInput = wrapper.querySelector('.custom-picker-input');
            const typeSelect = wrapper.querySelector('.custom-picker-type');
            const borderOptions = wrapper.querySelector('.custom-border-options');
            const borderWidthInput = wrapper.querySelector('.custom-border-width');
            const borderStyleSelect = wrapper.querySelector('.custom-border-style');

            const usesBorderOptions = () => typeSelect.value === 'tableCellBorder' || typeSelect.value === 'hrStyle';

            typeSelect.addEventListener('change', () => {
                borderOptions.style.display = usesBorderOptions() ? 'flex' : 'none';
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

    /* ==========================================================================
       [ 팝업/드롭다운 위치 보정 - 화면·다이얼로그 밖으로 잘리지 않게 ]
       ========================================================================== */

    const positionFixedDropdown = (menu, toggleBtn) => {
        if (!menu || !toggleBtn) return;

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

    /* ==========================================================================
       [ 표 삽입 크기 선택 팝업에 너비/정렬 옵션 추가 ]
       ========================================================================== */
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

            optionsDiv.addEventListener('mousedown', (e) => e.stopPropagation());
            optionsDiv.addEventListener('click', (e) => e.stopPropagation());

            targetContainer.appendChild(optionsDiv);

            targetContainer.addEventListener('click', (e) => {
                const isDimensionCell = e.target.closest('.note-dimension-picker-unselected, .note-dimension-picker-mouseover, .note-dimension-picker-mousecatcher, .note-dimension-picker');
                if (!isDimensionCell) return;

                let widthInput = optionsDiv.querySelector('.custom-table-width').value.trim() || '400';
                if (!isNaN(widthInput)) {
                    widthInput += 'px';
                }

                const alignVal = optionsDiv.querySelector('.custom-table-align').value || 'center';

                let attempts = 0;
                const checkAndApplyTable = setInterval(() => {
                    attempts++;
                    const tables = document.querySelectorAll('.note-editable table, .tox-edit-area table, table');
                    const lastTable = tables[tables.length - 1];

                    if (lastTable && !lastTable.dataset.customStyled) {
                        lastTable.dataset.customStyled = 'true';
                        lastTable.style.width = widthInput;

                        if (alignVal === 'center') {
                            lastTable.style.marginLeft = 'auto';
                            lastTable.style.marginRight = 'auto';
                        } else if (alignVal === 'right') {
                            lastTable.style.marginLeft = 'auto';
                            lastTable.style.marginRight = '0';
                        } else {
                            lastTable.style.marginLeft = '0';
                            lastTable.style.marginRight = 'auto';
                        }
                        clearInterval(checkAndApplyTable);
                    }

                    if (attempts > 10) clearInterval(checkAndApplyTable);
                }, 100);
            }, true);
        });
    };

    /* ==========================================================================
       [ 전역 이벤트 등록 & 개선 기능 일괄 실행 루프 ]
       ========================================================================== */
    document.addEventListener('selectionchange', () => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.classList.contains('note-editable') || activeEl.closest('.note-editable, .tox-edit-area'))) {
            saveSelection();
        }
    });

    document.addEventListener('paste', handlePasteFormatting, true);
    document.addEventListener('dragover', handleEditorDragOver, true);
    document.addEventListener('drop', handleEditorImageDrop, true);

    const runEnhancer = () => {
        loadWebFonts();
        forceInjectLabelDOM();
        injectFontDropdown();
        injectImageUploadButton();
        enableLibraryDropOnEditors();
        injectTemplateButtons();
        injectTableMergeSplitButtons();
        injectHrInsertButton();
        enhanceColorPalette();
        fixColorDropdownClipping();
        enhanceTableMenu();
        makeTablesResizable();
    };

    document.addEventListener('click', (e) => {
        const targetImg = e.target.closest('.handoutviewer img, .dialog:not(.editing) .note-editable img, img.r20-custom-lightbox-img');
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

        setTimeout(runEnhancer, 30);
    }, true);

    setInterval(runEnhancer, 500);

    const observer = new MutationObserver(runEnhancer);
    observer.observe(document.body, { childList: true, subtree: true });
})();
