// ==UserScript==
// @name         Roll20 Mod Script Manager
// @namespace    https://github.com/OHgolgyeo/script
// @version      1.0
// @author       오골계 (https://x.com/5golgyeo)
// @description  Roll20 게임 화면에서 필요할 때만 Mod 스크립트 분석/편집 창을 엽니다.
// @match        https://app.roll20.net/editor/*
// @match        https://app.roll20.net/editor/
// @match        https://app.roll20.net/campaigns/details/*
// @match        https://app.roll20.net/campaigns/scripts/*
// @match        https://app.roll20.net/campaigns/settings/*
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Mod%20Script%20Manager/Roll20%20Mod%20Script%20Setup.js
// @downloadURL  https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Mod%20Script%20Manager/Roll20%20Mod%20Script%20Setup.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.7.8';
    const IMPORT_ROOT = '!rmsm';
    const CHAT_CHUNK_SIZE = 2200;
    const CAMPAIGN_ID_KEY = 'rmsm-current-campaign-id';

    // 캠페인 ID를 DOM 로딩 전에 URL에서 확보한다.
    // 1) 게임 상세 페이지 /campaigns/details/<ID>
    // 2) Mod 설정 페이지 /campaigns/scripts/<ID>
    // 3) 입장 중간 주소 /editor/setcampaign/<ID>
    // 어느 경로에서든 확인되는 즉시 저장한다.
    (function captureCampaignIdEarly() {
        const patterns = [
            /\/editor\/setcampaign\/(\d+)/,
            /\/campaigns\/(?:details|scripts|settings)\/(\d+)/
        ];

        let id = '';
        for (const re of patterns) {
            const m = location.pathname.match(re);
            if (m) {
                id = m[1];
                break;
            }
        }

        if (id) {
            try {
                sessionStorage.setItem(CAMPAIGN_ID_KEY, id);
                localStorage.setItem(CAMPAIGN_ID_KEY, id);
                console.정보('[RMSM] captured campaign id from URL:', id, location.pathname);
            } catch (_) {}
        }
    })();

    // 게임 상세/설정 페이지에서는 ID 저장만 하고 UI 코드는 실행하지 않는다.
    // 실제 Manager 동작은 Roll20 VTT /editor/ 에서만 수행한다.
    if (!/^\/editor(?:\/|$)/.test(location.pathname)) {
        console.정보('[RMSM] campaign id capture page only:', location.pathname);
        return;
    }

    let analyzedScripts = [];
    let editState = { scripts: [] };
    let currentGameId = '';
    let scannedAt = '';
    let panel = null;
    let activeTab = 'analysis';
    let scanInProgress = false;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);

    function uniq(arr) {
        return [...new Set(arr.filter(Boolean))];
    }

    async function waitForCampaignId(timeoutMs = 15000) {
        const started = Date.now();

        function storedId() {
            try {
                const sid = sessionStorage.getItem(CAMPAIGN_ID_KEY);
                if (/^\d+$/.test(String(sid || ''))) return String(sid);
            } catch (_) {}
            try {
                const lid = localStorage.getItem(CAMPAIGN_ID_KEY);
                if (/^\d+$/.test(String(lid || ''))) return String(lid);
            } catch (_) {}
            return '';
        }

        function remember(id) {
            if (!/^\d+$/.test(String(id || ''))) return '';
            id = String(id);
            try { sessionStorage.setItem(CAMPAIGN_ID_KEY, id); } catch (_) {}
            try { localStorage.setItem(CAMPAIGN_ID_KEY, id); } catch (_) {}
            return id;
        }

        function pageWindow() {
            try {
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
            } catch (_) {}
            return window;
        }

        function fromD20(w) {
            try {
                if (!w || !w.d20 || !w.d20.Campaign) return '';
                const c = w.d20.Campaign;

                const raw = c.id ||
                    (typeof c.get === 'function' && (c.get('_id') || c.get('id'))) ||
                    (c.attributes && (c.attributes._id || c.attributes.id));

                if (/^\d+$/.test(String(raw || ''))) return String(raw);
            } catch (_) {}
            return '';
        }

        function fromLinks() {
            const links = [...document.querySelectorAll('a[href]')];
            for (const a of links) {
                const href = a.href || a.getAttribute('href') || '';
                let m = href.match(/\/campaigns\/(?:details|scripts|settings)\/(\d+)/);
                if (m) return m[1];

                m = href.match(/\/editor\/setcampaign\/(\d+)/);
                if (m) return m[1];
            }
            return '';
        }

        // 가장 신뢰할 수 있는 값: setcampaign 단계에서 미리 저장한 ID
        let id = storedId();
        if (id) return id;

        while (Date.now() - started < timeoutMs) {
            let m = location.href.match(/\/editor\/setcampaign\/(\d+)/);
            if (m) return remember(m[1]);

            id = fromD20(pageWindow()) || fromD20(window) || fromLinks();
            if (id) return remember(id);

            // document.referrer가 setcampaign 주소를 보존하는 환경도 지원
            try {
                m = String(document.referrer || '').match(/\/editor\/setcampaign\/(\d+)/);
                if (m) return remember(m[1]);
            } catch (_) {}

            await sleep(350);
        }

        throw new Error(
            '게임 ID를 자동으로 찾지 못했습니다. ' +
            'v0.5.2 설치 후 게임 상세 페이지를 한 번 연 다음 Launch Game으로 입장해 주세요.'
        );
    }

    function scopedEditorElements(pane, selector) {
        if (!pane) return [];
        return [...pane.querySelectorAll(selector)].filter(el => {
            const owner = el.closest('.script.tab-pane,.tab-pane.script');
            return !owner || owner === pane;
        });
    }

    function getEditorText(doc, pane) {
        if (!pane) return '';

        // 반드시 "이 스크립트 pane 소속" editor만 읽는다.
        // 상위 tab-pane 안에 여러 스크립트 editor가 들어 있는 경우를 차단한다.
        const cms = scopedEditorElements(pane, '.CodeMirror');
        if (cms.length === 1) {
            const cm = cms[0];
            if (cm.CodeMirror && typeof cm.CodeMirror.getValue === 'function') {
                return cm.CodeMirror.getValue();
            }
            const cmCode = cm.querySelector('.CodeMirror-code');
            if (cmCode && cmCode.innerText) return cmCode.innerText;
        } else if (cms.length > 1) {
            console.warn('[RMSM] 한 script pane에서 CodeMirror가 여러 개 발견되어 건너뜁니다.', pane.id, cms.length);
            return '';
        }

        const aces = scopedEditorElements(pane, '.ace_editor');
        if (aces.length === 1) {
            const aceEl = aces[0];
            try {
                if (aceEl.env && aceEl.env.editor && typeof aceEl.env.editor.getValue === 'function') {
                    return aceEl.env.editor.getValue();
                }
                const w = doc.defaultView;
                if (w && w.ace && typeof w.ace.edit === 'function') {
                    return w.ace.edit(aceEl).getValue();
                }
            } catch (_) {}
        } else if (aces.length > 1) {
            console.warn('[RMSM] 한 script pane에서 Ace editor가 여러 개 발견되어 건너뜁니다.', pane.id, aces.length);
            return '';
        }

        const textareas = scopedEditorElements(pane, 'textarea');
        if (textareas.length === 1) {
            const ta = textareas[0];
            return ta.value || ta.textContent || '';
        } else if (textareas.length > 1) {
            console.warn('[RMSM] 한 script pane에서 textarea가 여러 개 발견되어 건너뜁니다.', pane.id, textareas.length);
            return '';
        }

        return '';
    }

    function getScriptTabs(doc) {
        const out = [];
        const seen = new Set();

        // anchor부터 넓게 찾지 않고, 실제 script pane을 먼저 기준으로 잡는다.
        // 이걸로 상위 tab container가 한 스크립트로 잘못 인식되는 문제를 막는다.
        const panes = [...doc.querySelectorAll('.script.tab-pane,.tab-pane.script')];

        panes.forEach((pane, idx) => {
            const id = pane.id || '';
            if (!id || seen.has(id)) return;

            const editorCount =
                scopedEditorElements(pane, '.CodeMirror').length +
                scopedEditorElements(pane, '.ace_editor').length +
                scopedEditorElements(pane, 'textarea').length;

            if (!editorCount) return;

            let a = null;
            try {
                a = doc.querySelector('a[href="#' + CSS.escape(id) + '"]');
            } catch (_) {
                a = [...doc.querySelectorAll('a[href^="#"]')].find(x => x.getAttribute('href') === '#' + id) || null;
            }

            let name = a ? (a.textContent || '').trim().replace(/\s+/g, ' ') : '';
            name = name.replace(/\s*[×x]\s*$/i, '').trim();

            seen.add(id);
            out.push({
                a,
                pane,
                id,
                name: name || pane.getAttribute('data-name') || id || `Script ${idx + 1}`
            });
        });

        return out;
    }

    async function waitForPaneReady(doc, tab, timeoutMs = 2500) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const pane = doc.getElementById(tab.id) || tab.pane;
            if (pane) {
                const visible = pane.classList.contains('active') || pane.offsetParent !== null;
                const text = getEditorText(doc, pane);
                if ((visible || !tab.a) && text.trim()) return { pane, text };
            }
            await sleep(80);
        }

        const pane = doc.getElementById(tab.id) || tab.pane;
        return { pane, text:getEditorText(doc, pane) };
    }

    async function openScriptsFrame(gameId) {
        const old = document.getElementById('rmsm-hidden-script-frame');
        if (old) old.remove();

        const iframe = document.createElement('iframe');
        iframe.id = 'rmsm-hidden-script-frame';
        iframe.src = `https://app.roll20.net/campaigns/scripts/${encodeURIComponent(gameId)}`;
        iframe.style.cssText =
            'position:fixed;left:-12000px;top:-12000px;width:1400px;height:900px;' +
            'opacity:.001;pointer-events:none;z-index:-1';
        document.body.appendChild(iframe);

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Mod Scripts 페이지 로딩 시간이 초과되었습니다.')), 20000);
            iframe.addEventListener('load', () => {
                clearTimeout(timer);
                resolve();
            }, { once:true });
        });

        await sleep(1500);
        return iframe;
    }

    async function collectScripts(gameId, statusCb) {
        const iframe = await openScriptsFrame(gameId);
        const doc = iframe.contentDocument;
        if (!doc) throw new Error('Mod Scripts 페이지에 접근하지 못했습니다.');

        let tabs = getScriptTabs(doc);
        if (!tabs.length) {
            await sleep(1200);
            tabs = getScriptTabs(doc);
        }

        if (!tabs.length) {
            iframe.remove();
            throw new Error('개별 Mod 스크립트 pane을 찾지 못했습니다.');
        }

        const results = [];

        for (let i = 0; i < tabs.length; i++) {
            const t = tabs[i];
            statusCb && statusCb(`스크립트 읽는 중 ${i + 1}/${tabs.length}: ${t.name}`);

            if (t.a) {
                try {
                    t.a.click();
                } catch (_) {}
            }

            const ready = await waitForPaneReady(doc, t);
            const source = String(ready.text || '');

            if (!source.trim()) {
                console.warn('[RMSM] 소스를 읽지 못해 건너뜀:', t.name, t.id);
                continue;
            }

            // 각 result는 오직 해당 pane에서 읽은 source 하나만 가진다.
            results.push({
                name:t.name,
                source,
                paneId:t.id
            });
        }

        iframe.remove();
        return results;
    }

    function stripComments(src) {
        return src
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    }

    function extractStringConstants(src) {
        const map = {};
        const re = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\r\n]{1,160})\2\s*;/g;
        let m;
        while ((m = re.exec(src))) map[m[1]] = m[3];
        return map;
    }

    function normalizeSyntax(s) {
        return String(s || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[)"'`;]+$/g, '');
    }

    function rootOf(s) {
        s = normalizeSyntax(s);
        return s.startsWith('!') ? s.split(/\s+/)[0] : '';
    }

    function makeShortLabel(description, syntax) {
        const desc = String(description || '').trim();
        const cmd = String(syntax || '').trim();

        if (!desc) return cmd;

        let d = desc
            .replace(/\s+/g, ' ')
            .replace(/[.!?。]+$/g, '')
            .trim();

        const lower = d.toLowerCase();

        // ---- 한국어 우선 규칙 ----
        // 페이지 목록
        if (
            /모든\s*페이지/.test(d) &&
            /(이름|id|목록|확인|보여|출력)/i.test(d)
        ) return '페이지 목록 보기';

        // 특정 페이지 export
        if (
            /(특정\s*페이지|page[_\s-]*id)/i.test(d) &&
            /(내보내|export|저장)/i.test(d)
        ) return '특정 페이지 내보내기';

        // GM layer 포함
        if (
            /(gm\s*레이어|gm\s*layer)/i.test(d) &&
            /(포함|include)/i.test(d)
        ) return 'GM 레이어 포함';

        // 진단
        if (/(진단|원인|diagnos)/i.test(d)) {
            if (/그래픽|graphic/i.test(d)) return '그래픽 진단';
            if (/페이지|page/i.test(d)) return '페이지 진단';
            return '진단';
        }

        // 도움말
        if (/(도움말|help)/i.test(d)) return '도움말';

        // 표시/공개/숨김
        if (/(로그|변경\s*로그)/i.test(d) && /(공개|표시|보여)/i.test(d)) return '로그 공개';
        if (/(로그|변경\s*로그)/i.test(d) && /(숨|비공개)/i.test(d)) return '로그 숨김';

        // 이미지 변경
        if (/이미지/i.test(d) && /(url|주소)/i.test(d) && /(변경|교체)/i.test(d)) return '이미지 URL로 변경';
        if (/카드/i.test(d) && /이미지/i.test(d) && /(변경|교체)/i.test(d)) return '카드 이미지로 변경';

        // NPC 발화
        if (/(npc|캐릭터|저널)/i.test(d) && /(말|발화|대사)/i.test(d)) return 'NPC로 말하기';

        // 일반적인 "~할 수 있습니다", "~합니다" 제거
        d = d
            .replace(/할\s*수\s*있습니다$/i, '')
            .replace(/할\s*수\s*있어요$/i, '')
            .replace(/합니다$/i, '')
            .replace(/됩니다$/i, '')
            .replace(/입니다$/i, '')
            .replace(/하세요$/i, '')
            .replace(/할\s*수\s*있다$/i, '')
            .trim();

        // 동사형을 간단한 메뉴형으로 축약
        d = d
            .replace(/확인$/i, '보기')
            .replace(/확인할$/i, '보기')
            .replace(/확인하기$/i, '보기')
            .replace(/내보내려면$/i, '내보내기')
            .replace(/내보냅니다$/i, '내보내기')
            .replace(/내보내기$/i, '내보내기')
            .replace(/포함합니다$/i, '포함')
            .replace(/변경합니다$/i, '변경')
            .replace(/교체합니다$/i, '교체')
            .trim();

        // 문장이 길면 핵심 앞부분만 보수적으로 사용
        if (d.length > 28) {
            const clauses = d.split(/[,，;；]|(?:\s+(?:그리고|또는|및)\s+)/);
            if (clauses[0] && clauses[0].trim().length >= 4) {
                d = clauses[0].trim();
            }
        }

        // 너무 짧거나 정보가 없는 표현은 command fallback
        if (
            !d ||
            d.length < 2 ||
            /^(?:사용|입력|실행|선택|확인|보기|처리)$/.test(d)
        ) {
            return cmd;
        }

        // ---- 영어 간단 규칙 ----
        if (/^list\b/i.test(d)) return d.replace(/^list\b/i, '').trim() + ' 목록';
        if (/^show\b/i.test(d)) return d.replace(/^show\b/i, '').trim() + ' 보기';
        if (/^hide\b/i.test(d)) return d.replace(/^hide\b/i, '').trim() + ' 숨김';
        if (/^include\b/i.test(d)) return d.replace(/^include\b/i, '').trim() + ' 포함';
        if (/^export\b/i.test(d)) return d.replace(/^export\b/i, '').trim() + ' 내보내기';

        return d.slice(0, 40);
    }

    function analyzeScript(name, source) {
        const structural = stripComments(source);
        const constants = extractStringConstants(source);
        const rank = { comment:5, confirmed:4, documented:3, pattern:2, inferred:1 };

        const commands = new Map();
        const rootsFromComment = new Set();
        const rootsFromCode = new Set();

        function cleanDescription(text) {
            return String(text || '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/\\n/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(/^[\s:：\-–—|]+|[\s:：\-–—|]+$/g, '')
                .trim()
                .slice(0, 180);
        }

        function normalizeCommandSyntax(s) {
            return normalizeSyntax(String(s || '')
                .replace(/[.,;!?。！？]+$/g, '')
                .trim());
        }

        function upsert(syntax, evidence, confidence, description='', sourceKind='code') {
            syntax = normalizeCommandSyntax(syntax);
            if (!syntax || !syntax.startsWith('!') || syntax.length > 240) return;

            const root = rootOf(syntax);
            if (sourceKind === 'comment') rootsFromComment.add(root);
            else rootsFromCode.add(root);

            const next = {
                syntax,
                evidence,
                confidence,
                description: cleanDescription(description),
                sourceKind
            };

            const prev = commands.get(syntax);
            if (!prev) {
                commands.set(syntax, next);
                return;
            }

            const prevRank = rank[prev.confidence] || 0;
            const nextRank = rank[next.confidence] || 0;

            // 주석이 항상 최우선.
            if (next.sourceKind === 'comment' && prev.sourceKind !== 'comment') {
                next.description = next.description || prev.description || '';
                commands.set(syntax, next);
                return;
            }

            // 둘 다 주석이면 설명이 더 풍부한 쪽을 유지
            if (next.sourceKind === 'comment' && prev.sourceKind === 'comment') {
                if ((!prev.description && next.description) ||
                    (next.description && next.description.length > prev.description.length)) {
                    prev.description = next.description;
                }
                return;
            }

            // 기존이 주석이면 본문은 설명 보충만
            if (prev.sourceKind === 'comment') {
                if (!prev.description && next.description) prev.description = next.description;
                return;
            }

            if (nextRank > prevRank) {
                next.description = next.description || prev.description || '';
                commands.set(syntax, next);
            } else if (!prev.description && next.description) {
                prev.description = next.description;
            }
        }

        function parseCommandFromCommentLine(line) {
            line = String(line || '')
                .replace(/^\s*(?:\/\/+|\/\*+|\*+|\*\/)/, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const bang = line.indexOf('!');
            if (bang < 0) return null;

            const prefix = cleanDescription(line.slice(0, bang));
            let rest = line.slice(bang).trim();

            // root
            const rootMatch = rest.match(/^(![^\s,;:|]+)/);
            if (!rootMatch) return null;

            const root = normalizeCommandSyntax(rootMatch[1]);
            let consumed = root.length;
            let syntax = root;

            const tail = rest.slice(consumed).trim();

            // option/subcommand/argument tokens만 명령에 포함
            // 자연어 prose는 설명으로 넘긴다.
            const tokenRe = /^(--[A-Za-z][A-Za-z0-9_-]*|<[^>]+>|\[[^\]]+\]|[A-Z][A-Z0-9_-]*(?:\|[A-Z][A-Z0-9_-]*)?|[a-z][a-z0-9_-]{1,30})\b/;
            let remain = tail;
            const taken = [];

            while (remain) {
                const sep = remain.match(/^(?:\s+|,\s*)/);
                if (sep) remain = remain.slice(sep[0].length);

                // 한국어 조사/설명 시작
                if (/^(?:로|으로|를|을|은|는|이|가|에|에서|부터|까지)\b/.test(remain)) break;
                // 영어 prose 시작
                if (/^(?:in\s+chat|in\s+the\s+chat|to\s+use|for\s+use|to\b|for\b|with\b)\b/i.test(remain)) break;
                // 문장부호 설명 시작
                if (/^(?:[-–—:：|])\s+/.test(remain)) break;

                const tm = remain.match(tokenRe);
                if (!tm) break;

                const tok = tm[1];

                // prose처럼 보이는 일반 단어는 command token으로 너무 많이 먹지 않도록 제한
                if (/^(?:in|chat|use|using|type|enter|command|please|this|the|a|an)$/i.test(tok)) break;

                taken.push(tok);
                remain = remain.slice(tm[0].length).trim();
            }

            if (taken.length) syntax += ' ' + taken.join(' ');

            let descParts = [];
            if (prefix) descParts.push(prefix);

            let desc = remain
                .replace(/^(?:[-–—:：|]\s*)/, '')
                .replace(/^(?:로|으로|를|을|은|는|이|가|에|에서|부터|까지)\s+/, '')
                .trim();

            if (desc) descParts.push(desc);

            let description = cleanDescription(descParts.join(' '));

            if (/^(?:사용|입력|실행|선택|확인)하세요[.!]?$/i.test(description)) {
                description = '';
            }

            return { syntax: normalizeCommandSyntax(syntax), description };
        }

        // ---------------------------------------------------
        // 1순위: 주석에서 명령어 수집
        // ---------------------------------------------------
        const commentBlocks = [
            ...(source.match(/\/\/[^\n]*/g) || []),
            ...(source.match(/\/\*[\s\S]*?\*\//g) || [])
        ];

        commentBlocks.forEach(block => {
            String(block).split(/\n/).forEach(line => {
                if (!line.includes('!')) return;
                const parsed = parseCommandFromCommentLine(line);
                if (!parsed) return;

                // "!foo in chat."는 root command + 설명으로 처리
                upsert(parsed.syntax, 'comment', 'comment', parsed.description, 'comment');
            });
        });

        // ---------------------------------------------------
        // 2순위: 본문 실행 코드에서 주석에 없는 명령 보충
        // ---------------------------------------------------
        function codeAdd(syntax, evidence, confidence='confirmed', description='') {
            syntax = normalizeCommandSyntax(syntax);
            if (!syntax) return;

            // 주석에 완전히 같은 syntax가 있으면 본문에서는 추가하지 않음
            if (commands.has(syntax) && commands.get(syntax).sourceKind === 'comment') {
                if (!commands.get(syntax).description && description) {
                    commands.get(syntax).description = cleanDescription(description);
                }
                return;
            }

            upsert(syntax, evidence, confidence, description, 'code');
        }

        let re, m;

        re = /\b(?:msg\.)?content\s*(?:===|==)\s*(['"`])(![^'"`\r\n]{0,180})\1/g;
        while ((m = re.exec(structural))) codeAdd(m[2], 'content equality');

        re = /\.startsWith\(\s*(['"`])(![^'"`\r\n]{0,160})\1\s*\)/g;
        while ((m = re.exec(structural))) codeAdd(m[2], 'startsWith');

        re = /\.indexOf\(\s*(['"`])(![^'"`\r\n]{0,160})\1\s*\)\s*(?:===|==)\s*0/g;
        while ((m = re.exec(structural))) codeAdd(m[2], 'indexOf(...)=0');

        re = /\bcase\s+(['"`])(![^'"`\r\n]{0,160})\1\s*:/g;
        while ((m = re.exec(structural))) codeAdd(m[2], 'switch case');

        re = /\/\^((?:\\.|[^\/\n])*!+(?:\\.|[^\/\n]){0,120})\/[gimyus]*/g;
        while ((m = re.exec(structural))) {
            let lit = m[1]
                .replace(/\\b.*$/, '')
                .replace(/\\s.*$/, '')
                .replace(/\\([!#$@._:-])/g, '$1')
                .replace(/\\-/g, '-');
            if (lit.startsWith('!')) codeAdd(lit, 'regex');
        }

        Object.entries(constants).forEach(([varName, value]) => {
            if (!value.startsWith('!')) return;
            const useRe = new RegExp(
                '(?:content[^\\n]{0,140}(?:startsWith|indexOf)\\s*\\(\\s*' + varName + '\\b|' +
                'content\\s*(?:===|==)\\s*' + varName + '\\b|' +
                '(?:startsWith|indexOf)\\s*\\(\\s*' + varName + '\\b)'
            );
            if (useRe.test(structural)) codeAdd(value, `constant ${varName}`);
        });

        re = /\.(?:startsWith|indexOf)\(\s*(['"`])(![^'"`\r\n]{0,30})\1\s*\+/g;
        while ((m = re.exec(structural))) {
            codeAdd(m[2] + '<동적 값>', 'dynamic prefix', 'pattern', '동적 명령어');
        }

        re = /\.indexOf\(\s*(['"`])(!{1,3}|![#$@%^&*+=:;?.~-])\1\s*\)\s*(?:===|==)\s*0/g;
        while ((m = re.exec(structural))) {
            codeAdd(m[2] + '<동적 값>', 'dynamic prefix', 'pattern', '동적 명령어');
        }

        // ---------------------------------------------------
        // 본문 option/subcommand는 "주석에 없는 것만" 추가
        // ---------------------------------------------------
        const optionTokens = uniq([
            ...source.matchAll(/(?:^|[\s"'`(\[])--([A-Za-z][A-Za-z0-9_-]*)\b/g)
        ].map(x => '--' + x[1]));

        const subcommandTokens = new Set();

        [
            /\b(?:args?|parts?|tokens?)\s*\[[^\]]+\]\s*(?:===|==)\s*['"]([A-Za-z][A-Za-z0-9_-]{0,40})['"]/g,
            /\bcase\s+['"]([A-Za-z][A-Za-z0-9_-]{0,40})['"]\s*:/g,
            /\.includes\(\s*['"]([A-Za-z][A-Za-z0-9_-]{0,40})['"]\s*\)/g
        ].forEach(rx => {
            let mm;
            while ((mm = rx.exec(structural))) subcommandTokens.add(mm[1]);
        });

        const allRoots = [...new Set([...rootsFromComment, ...rootsFromCode])];

        if (allRoots.length === 1) {
            optionTokens.forEach(opt => {
                const syntax = allRoots[0] + ' ' + opt;
                if (!commands.has(syntax)) codeAdd(syntax, 'option token', 'inferred');
            });

            subcommandTokens.forEach(sub => {
                if (/^(?:api|gm|true|false|null|undefined|ready|help)$/i.test(sub)) return;
                const syntax = allRoots[0] + ' ' + sub;
                if (!commands.has(syntax)) codeAdd(syntax, 'subcommand token', 'inferred');
            });
        }

        // ---------------------------------------------------
        // 본문 help 문자열은 설명 보충 전용
        // ---------------------------------------------------
        const helpLines = [];

        function addHelp(raw) {
            let text = String(raw || '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(?:p|div|li|tr|h\d)>/gi, '\n');

            text.split(/\n/).forEach(line => {
                line = String(line || '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (line.includes('!')) helpLines.push(line);
            });
        }

        const literalRe = /(['"`])([^'"`\r\n]{0,520})\1/g;
        while ((m = literalRe.exec(source))) {
            if (m[2].includes('!')) addHelp(m[2]);
        }

        function findHelpDescription(command) {
            const cmd = normalizeCommandSyntax(command);
            let best = '';

            helpLines.forEach(line => {
                const bang = line.indexOf('!');
                if (bang < 0) return;

                const prefix = cleanDescription(line.slice(0, bang));
                const rest = line.slice(bang).trim();

                if (!(rest === cmd || rest.startsWith(cmd + ' '))) return;

                let tail = rest.slice(cmd.length).trim();

                // 다른 option/subcommand가 이어지면 이 command 설명이 아님
                if (/^(?:--[A-Za-z]|[A-Za-z][A-Za-z0-9_-]*\b)/.test(tail) &&
                    !/^(?:in\s+chat|in\s+the\s+chat|to\b|for\b|with\b)/i.test(tail) &&
                    !/^(?:로|으로|를|을|은|는|이|가|에|에서)\b/.test(tail)) {
                    return;
                }

                tail = tail
                    .replace(/^(?:[-–—:：|]\s*)/, '')
                    .replace(/^(?:로|으로|를|을|은|는|이|가|에|에서)\s+/, '')
                    .trim();

                let desc = cleanDescription([prefix, tail].filter(Boolean).join(' '));
                if (desc && desc.length > best.length) best = desc;
            });

            return best;
        }

        commands.forEach((item, syntax) => {
            if (!item.description) {
                item.description = findHelpDescription(syntax);
            }
        });

        let result = [...commands.values()];

        // prose 안전 필터
        result = result.filter(c => {
            const rest = c.syntax.slice(rootOf(c.syntax).length).trim();
            if (!rest) return true;
            if (/[.!?。！？]$/.test(c.syntax)) return false;
            if (/\b(?:in\s+chat|in\s+the\s+chat|to\s+use|for\s+use)\b/i.test(rest)) return false;
            return true;
        });

        result = result
            .sort((a,b) => {
                // 주석 우선, 그 다음 confidence
                if (a.sourceKind !== b.sourceKind) {
                    return a.sourceKind === 'comment' ? -1 : 1;
                }
                const d = (rank[b.confidence] || 0) - (rank[a.confidence] || 0);
                return d || a.syntax.length - b.syntax.length;
            })
            .slice(0,100)
            .map(c => {
                const shortLabel = makeShortLabel(c.description, c.syntax);
                return {
                    ...c,
                    shortLabel,
                    displayName: shortLabel || c.syntax
                };
            });

        return {
            name,
            gmOnly:/playerIsGM\s*\(\s*msg\.playerid/.test(structural),
            noChatCommand:/on\s*\(\s*['"]chat:message['"]/.test(structural) && result.length === 0,
            commands:result
        };
    }

    function preserveEdits(nextScripts) {
        const prevScripts = analyzedScripts;
        const prevState = editState;
        const nextState = { scripts:[] };

        nextScripts.forEach((script, si) => {
            const oi = prevScripts.findIndex(s => s.name === script.name);
            const oldSp = oi >= 0 ? prevState.scripts[oi] : null;

            const sp = {
                enabled: oldSp ? oldSp.enabled !== false : false,
                label: oldSp?.label || script.name,
                commands:[]
            };

            script.commands.forEach((cmd, ci) => {
                let oldCp = null;
                if (oi >= 0) {
                    const oci = prevScripts[oi].commands.findIndex(c => c.syntax === cmd.syntax);
                    if (oci >= 0) oldCp = prevState.scripts[oi]?.commands?.[oci] || null;
                }

                sp.commands[ci] = {
                    enabled: oldCp ? oldCp.enabled !== false : false,
                    label: oldCp?.label || cmd.shortLabel || cmd.displayName || cmd.syntax
                };
            });

            nextState.scripts[si] = sp;
        });

        analyzedScripts = nextScripts;
        editState = nextState;
    }

    function payloadFromCurrent() {
        return {
            schema:'roll20-mod-script-manager/import-v3',
            scannerVersion:VERSION,
            gameId:currentGameId,
            scannedAt,
            scripts:analyzedScripts.map((script, si) => ({
                ...script,
                enabled:editState.scripts[si]?.enabled !== false,
                label:editState.scripts[si]?.label || script.name,
                commands:script.commands.map((cmd, ci) => ({
                    ...cmd,
                    enabled:editState.scripts[si]?.commands?.[ci]?.enabled !== false,
                    label:editState.scripts[si]?.commands?.[ci]?.label || cmd.shortLabel || cmd.displayName || cmd.syntax
                }))
            }))
        };
    }

    function utf8ToBase64(str) {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        const step = 0x8000;

        for (let i = 0; i < bytes.length; i += step) {
            binary += String.fromCharCode(...bytes.subarray(i, i + step));
        }
        return btoa(binary);
    }

    function makeImportLines(payload) {
        const b64 = utf8ToBase64(JSON.stringify(payload));
        const session = 'rmsm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
        const chunks = [];

        for (let i = 0; i < b64.length; i += CHAT_CHUNK_SIZE) {
            chunks.push(b64.slice(i, i + CHAT_CHUNK_SIZE));
        }

        return chunks.map((chunk, i) =>
            `${IMPORT_ROOT} import ${session} ${i+1}/${chunks.length} ${chunk}`
        );
    }

    function findChatInput() {
        return document.querySelector('#textchat-input textarea') ||
               document.querySelector('#textchat-input input[type="text"]') ||
               document.querySelector('textarea.ui-autocomplete-input');
    }

    function findChatSendButton() {
        return document.querySelector('#textchat-input button[type="submit"]') ||
               document.querySelector('#textchat-input input[type="submit"]') ||
               document.querySelector('#textchat-input .btn');
    }

    async function sendChatCommand(command) {
        const input = findChatInput();
        if (!input) throw new Error('Roll20 채팅 입력창을 찾지 못했습니다.');

        input.focus();
        input.value = command;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));

        const button = findChatSendButton();
        if (button) {
            button.click();
        } else {
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key:'Enter',
                code:'Enter',
                keyCode:13,
                which:13,
                bubbles:true
            }));
        }

        await sleep(180);
    }

    async function applyToRoll20(statusCb) {
        if (!analyzedScripts.length) throw new Error('먼저 스크립트를 분석해 주세요.');

        const lines = makeImportLines(payloadFromCurrent());
        statusCb && statusCb(`Roll20에 적용 중... 0/${lines.length}`);

        for (let i = 0; i < lines.length; i++) {
            await sendChatCommand(lines[i]);
            statusCb && statusCb(`Roll20에 적용 중... ${i+1}/${lines.length}`);
        }

        statusCb && statusCb('편집 내용이 저장되었습니다.');
    }

    function renderAnalysis(content) {
        if (!analyzedScripts.length) {
            content.innerHTML = '<div class="rmsm-empty">스크립트를 읽는 중이거나 아직 분석되지 않았습니다.</div>';
            return;
        }

        content.innerHTML = analyzedScripts.map(s => `
            <section class="rmsm-card">
                <div class="rmsm-card-title">
                    ${esc(s.name)}
                    ${s.gmOnly ? '<span class="rmsm-tag">GM</span>' : ''}
                </div>
                ${s.noChatCommand ? '<div class="rmsm-muted">채팅 명령어 감지 없음</div>' : ''}
                ${s.commands.map(c => `
                    <div class="rmsm-command" style="display:block">
                        <div style="display:flex;align-items:baseline;gap:6px;min-width:0">
                            <code style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                                  title="${esc(c.syntax)}">${esc(c.syntax)}</code>
                            <span class="rmsm-confidence">${c.sourceKind === 'comment' ? '주석' : esc(c.confidence)}</span>
                        </div>
                        ${c.shortLabel && c.shortLabel !== c.syntax
                            ? `<div style="font-size:12px;font-weight:700;color:#444;margin-top:3px">${esc(c.shortLabel)}</div>`
                            : ''}
                        ${c.description
                            ? `<div style="font-size:11px;color:#888;margin-top:2px;line-height:1.45">${esc(c.description)}</div>`
                            : ''}
                    </div>
                `).join('')}
            </section>
        `).join('');
    }

    function renderEdit(content) {
        if (!analyzedScripts.length) {
            content.innerHTML = '<div class="rmsm-empty">스크립트를 읽는 중이거나 아직 분석되지 않았습니다.</div>';
            return;
        }

        content.innerHTML = analyzedScripts.map((script, si) => {
            const sp = editState.scripts[si];

            return `
                <section class="rmsm-card">
                    <div class="rmsm-script-edit-row">
                        <label class="rmsm-check" title="이 스크립트 전체 포함/제외">
                            <input type="checkbox" data-role="script-enabled" data-si="${si}" ${sp.enabled !== false ? 'checked' : ''}>
                        </label>
                        <div style="flex:1;min-width:0">
                            <div style="font-size:10px;font-weight:700;color:#777;margin-bottom:3px;letter-spacing:.04em">SCRIPT</div>
                            <input class="rmsm-label-input rmsm-script-label"
                                   data-role="script-label" data-si="${si}"
                                   value="${esc(sp.label || script.name)}">
                        </div>
                    </div>

                    <div class="rmsm-command-list ${sp.enabled === false ? 'rmsm-disabled-group' : ''}">
                        ${script.commands.map((cmd, ci) => {
                            const cp = sp.commands[ci];

                            return `
                                <div class="rmsm-edit-command">
                                    <label class="rmsm-check" title="이 명령어 포함/제외">
                                        <input type="checkbox" data-role="command-enabled"
                                               data-si="${si}" data-ci="${ci}"
                                               ${cp.enabled !== false ? 'checked' : ''}>
                                    </label>

                                    <div class="rmsm-edit-main">
                                        <div style="font-size:10px;color:#777;margin-bottom:2px">매크로 표시 이름</div>
                                        <input class="rmsm-label-input"
                                               data-role="command-label"
                                               data-si="${si}" data-ci="${ci}"
                                               value="${esc(cp.label || cmd.shortLabel || cmd.displayName || cmd.syntax)}">
                                        <div style="font-size:11px;color:#666;word-break:break-word"
                                             title="${esc(cmd.syntax)}">
                                            <code>${esc(cmd.syntax)}</code>
                                        </div>
                                        ${cmd.description
                                            ? `<div style="font-size:11px;color:#888;margin-top:3px;line-height:1.45;white-space:normal;word-break:keep-all">${esc(cmd.description)}</div>`
                                            : ''}
                                    </div>
                                </div>`;
                        }).join('')}
                    </div>
                </section>`;
        }).join('');

        content.querySelectorAll('[data-role="script-enabled"]').forEach(input => {
            input.addEventListener('change', e => {
                const si = Number(e.currentTarget.dataset.si);
                editState.scripts[si].enabled = e.currentTarget.checked;
                e.currentTarget.closest('.rmsm-card')
                    .querySelector('.rmsm-command-list')
                    .classList.toggle('rmsm-disabled-group', !e.currentTarget.checked);
                setStatus('체크 상태가 반영되었습니다.');
            });
        });

        content.querySelectorAll('[data-role="command-enabled"]').forEach(input => {
            input.addEventListener('change', e => {
                const si = Number(e.currentTarget.dataset.si);
                const ci = Number(e.currentTarget.dataset.ci);
                editState.scripts[si].commands[ci].enabled = e.currentTarget.checked;
                setStatus('체크 상태가 반영되었습니다.');
            });
        });

        content.querySelectorAll('[data-role="script-label"]').forEach(input => {
            input.addEventListener('input', e => {
                editState.scripts[Number(e.currentTarget.dataset.si)].label = e.currentTarget.value;
                setStatus('표시 이름이 반영되었습니다.');
            });
        });

        content.querySelectorAll('[data-role="command-label"]').forEach(input => {
            input.addEventListener('input', e => {
                const si = Number(e.currentTarget.dataset.si);
                const ci = Number(e.currentTarget.dataset.ci);
                editState.scripts[si].commands[ci].label = e.currentTarget.value;
                setStatus('표시 이름이 반영되었습니다.');
            });
        });
    }

    function setStatus(text) {
        const el = panel?.querySelector('#rmsm-status');
        if (el) el.textContent = text;
    }

    function installDrag(box, handle) {
        let drag = null;

        handle.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('button')) return;
            const r = box.getBoundingClientRect();
            drag = { dx:e.clientX-r.left, dy:e.clientY-r.top };
            e.preventDefault();
        });

        window.addEventListener('pointermove', e => {
            if (!drag) return;
            const x = Math.max(0, Math.min(window.innerWidth-box.offsetWidth, e.clientX-drag.dx));
            const y = Math.max(0, Math.min(window.innerHeight-box.offsetHeight, e.clientY-drag.dy));
            box.style.left = `${x}px`;
            box.style.top = `${y}px`;
            box.style.right = 'auto';
        });

        window.addEventListener('pointerup', () => { drag = null; });
    }

    function ensurePanel() {
        if (panel && document.body.contains(panel)) return panel;

        if (!document.getElementById('rmsm-style-v050')) {
            const style = document.createElement('style');
            style.id = 'rmsm-style-v050';
            style.textContent = `
                #rmsm-panel{position:fixed;z-index:2147483647;right:24px;top:72px;width:440px;max-height:78vh;
                    background:#fff;color:#222;border:1px solid #555;border-radius:9px;box-shadow:0 7px 28px rgba(0,0,0,.38);
                    font:13px/1.4 Arial,sans-serif;overflow:hidden}
                #rmsm-panel *{box-sizing:border-box}
                #rmsm-head{height:40px;padding:8px 12px;background:#333;color:#fff;display:flex;align-items:center;cursor:move;user-select:none}
                #rmsm-head strong{flex:1}
                #rmsm-close{border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer}
                #rmsm-tabs{display:flex;border-bottom:1px solid #ccc}
                .rmsm-tab{flex:1;border:0;background:#eee;padding:7px;cursor:pointer}
                .rmsm-tab.active{background:#fff;font-weight:bold;border-bottom:2px solid #555}
                #rmsm-status{padding:7px 12px;background:#fafafa;border-bottom:1px solid #ddd;font-size:11px;color:#666}
                #rmsm-content{padding:10px 12px 14px;overflow:auto;max-height:calc(78vh - 158px)}
                #rmsm-footer{padding:12px;border-top:1px solid #ddd;background:#fafafa;display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0}
                #rmsm-footer button{padding:7px 11px;cursor:pointer;min-height:32px}
                .rmsm-card{border:1px solid #c8c8c8;border-radius:7px;padding:0;margin-bottom:10px;background:#fff;overflow:hidden}
                .rmsm-card-title{font-weight:700;padding:8px 10px;background:#f1f3f5;border-bottom:1px solid #d4d7da;margin:0}
                .rmsm-tag{font-size:10px;background:#8b5d5d;color:#fff;border-radius:3px;padding:1px 4px;margin-left:4px}
                .rmsm-command{padding:7px 10px 7px 18px;min-width:0;border-top:1px solid #f1f1f1}
                .rmsm-confidence{font-size:10px;color:#999;white-space:nowrap;margin-left:auto}
                .rmsm-muted,.rmsm-empty{color:#777;padding:5px}
                .rmsm-script-edit-row,.rmsm-edit-command{display:flex;gap:8px;align-items:flex-start}
                .rmsm-script-edit-row{align-items:center;margin:0;padding:9px 10px;background:#f1f3f5;border-bottom:1px solid #d4d7da}
                .rmsm-edit-command{padding:7px 10px;border-top:1px solid #eee;align-items:center}
                .rmsm-edit-main{flex:1;min-width:0}
                .rmsm-label-input{width:100%;padding:5px 7px;border:1px solid #bbb;border-radius:4px;margin-bottom:2px}
                .rmsm-script-label{font-weight:700;background:#fff;border-color:#aaa}
                .rmsm-edit-main code{font-size:11px;color:#666;word-break:break-all}
                .rmsm-check{display:flex;align-items:center;justify-content:center;flex:0 0 22px}
                .rmsm-check input[type="checkbox"]{display:block!important;appearance:auto!important;-webkit-appearance:auto!important;
                    width:16px!important;height:16px!important;margin:0!important;padding:0!important;cursor:pointer}
                .rmsm-command-list{padding:0 0 2px;background:#fff}.rmsm-disabled-group{opacity:.42}
            `;
            document.head.appendChild(style);
        }

        panel = document.createElement('div');
        panel.id = 'rmsm-panel';
        panel.innerHTML = `
            <div id="rmsm-head">
                <strong>Roll20 Mod Script Manager <span style="opacity:.6">v${VERSION}</span></strong>
                <button id="rmsm-close" title="닫기">×</button>
            </div>
            <div id="rmsm-status">준비 중...</div>
            <div id="rmsm-tabs">
                <button class="rmsm-tab" data-tab="analysis">분석</button>
                <button class="rmsm-tab" data-tab="edit">편집</button>
            </div>
            <div id="rmsm-content"></div>
            <div id="rmsm-footer">
                <button id="rmsm-rescan">다시 분석</button>
                <button id="rmsm-apply">편집 완료</button>
            </div>
        `;
        document.body.appendChild(panel);

        installDrag(panel, panel.querySelector('#rmsm-head'));

        panel.querySelector('#rmsm-close').addEventListener('click', () => {
            panel.remove();
            panel = null;
        });

        panel.querySelectorAll('.rmsm-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                renderPanel();
            });
        });

        panel.querySelector('#rmsm-rescan').addEventListener('click', () => scanAndRender());
        panel.querySelector('#rmsm-apply').addEventListener('click', async () => {
            try {
                panel.querySelector('#rmsm-apply').disabled = true;
                await applyToRoll20(setStatus);
                setTimeout(() => {
                    if (panel) {
                        panel.remove();
                        panel = null;
                    }
                }, 700);
            } catch (e) {
                setStatus('오류: ' + (e?.message || e));
            } finally {
                if (panel) panel.querySelector('#rmsm-apply').disabled = false;
            }
        });

        return panel;
    }

    function renderPanel() {
        ensurePanel();
        panel.querySelectorAll('.rmsm-tab').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.tab === activeTab)
        );

        const content = panel.querySelector('#rmsm-content');
        if (activeTab === 'edit') renderEdit(content);
        else renderAnalysis(content);
    }

    async function scanAndRender() {
        if (scanInProgress) return;
        scanInProgress = true;

        ensurePanel();
        setStatus('게임 ID 확인 중...');

        try {
            currentGameId = await waitForCampaignId();
            setStatus(`게임 ${currentGameId}: Mod Scripts 읽는 중...`);

            const raw = await collectScripts(currentGameId, setStatus);
            setStatus(`${raw.length}개 스크립트 분석 중...`);

            preserveEdits(raw.map(s => analyzeScript(s.name, s.source)));
            scannedAt = new Date().toISOString();

            const count = analyzedScripts.reduce((n,s) => n+s.commands.length, 0);
            setStatus(`${analyzedScripts.length}개 Mod / ${count}개 명령 후보`);
            renderPanel();
        } catch (e) {
            setStatus('오류: ' + (e?.message || e));
        } finally {
            scanInProgress = false;
        }
    }

    async function openManager(tab) {
        activeTab = tab === 'edit' ? 'edit' : 'analysis';
        ensurePanel();
        renderPanel();

        if (!analyzedScripts.length) {
            await scanAndRender();
        }
    }

    function normalizedHref(a) {
        let href = a.getAttribute('href') || '';
        try { href = decodeURIComponent(href); } catch (_) {}
        return href.replace(/^javascript:/i, '').trim();
    }

    // Roll20 채팅 메뉴의 분석/편집 버튼을 브라우저에서 직접 가로챈다.
    document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a');
        if (!a) return;

        const href = normalizedHref(a);

        if (href === '!rmsm ui-analysis' || href.endsWith('!rmsm ui-analysis')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openManager('analysis');
        } else if (href === '!rmsm ui-edit' || href.endsWith('!rmsm ui-edit')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openManager('edit');
        }
    }, true);

    console.info('[Roll20 Mod Script Manager] userscript v' + VERSION + ' loaded');
    try {
        console.info('[RMSM] stored campaign id:',
            sessionStorage.getItem(CAMPAIGN_ID_KEY) || localStorage.getItem(CAMPAIGN_ID_KEY) || '(none)');
    } catch (_) {}
})();
