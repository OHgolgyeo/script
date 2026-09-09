// ==UserScript==
// @name         Roll20 Portrait for Emotion
// @namespace    https://github.com/OHgolgyeo/script
// @version      1.0
// @author       오골계 (https://x.com/5golgyeo)
// @description  "대사 @표정" 또는 "@표정"만 입력했을 때, 대사는 그대로 보내고 "@표정" 태그는 "!@표정"으로 바꿔서 따로 보내 화면에서 안 보이게 함.
// @match        https://app.roll20.net/editor*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Portrait%20Album%20%26%20Visual%20Dialogue/Roll20%20Portrait%20for%20Emotion.js
// @downloadURL  https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Portrait%20Album%20%26%20Visual%20Dialogue/Roll20%20Portrait%20for%20Emotion.js
// ==/UserScript==

(function () {
  'use strict';

  document.addEventListener('keydown', function (e) {
    if (e.keyCode !== 13) return;

    const textarea = document.querySelector('#textchat-input textarea');
    if (!textarea || textarea !== document.activeElement) return;

    const val = textarea.value;

    // 이미 !, /, # 로 시작하는 명령어는 건드리지 않음
    if (/^\s*[!/#]/.test(val)) return;

    // 끝에 "@표정이름"이 붙어있는지 확인 (대사 있든 없든 다 걸림)
    const tagMatch = val.match(/@(\S+)\s*$/);
    if (!tagMatch) return;

    const dialogue = val.slice(0, tagMatch.index).trim();
    const emotionName = tagMatch[1];

    e.preventDefault();
    e.stopImmediatePropagation();

    const btn = document.querySelector('#textchat-input .btn');

    function send(text) {
      textarea.value = text;
      if (btn) btn.click();
    }

    if (dialogue) {
      // 대사가 있으면: 대사 먼저 정상적으로 보내고, 잠깐 뒤에 숨김 명령어 전송
      send(dialogue);
      setTimeout(function () {
        send('!@' + emotionName);
      }, 150);
    } else {
      // 대사 없이 태그만 있으면 바로 숨김 명령어만 전송
      send('!@' + emotionName);
    }
  }, true);
})();
