// =============================================
//     Roll20 Video Player
// ---------------------------------------------------
//     !컷 ?{영상 링크(확장자 포함)|}, ?{대기시간|}, ?{모드|full|map|window}, "?{저널이름|}"
//
//     콤마(,)로 구분해서 입력합니다.
//     URL 뒤로는 전부 생략 가능하고, 생략한
//     자리는 그냥 비워두면 됩니다 (예: "!컷 주소,,,\"김 철 수\""처럼 대기초/ 형태를 비워도 됨).
//     - 대기초    : 몇 초 뒤에 재생할지. 생략하면 0초(즉시)
//     - full|map|window : 생략하면 full(전체화면).
//          - full   : 화면 전체를 덮는 전체화면 재생
//          - map    : 채팅창 옆, 맵시트 영역에 꽉차게 재생
//          - window : 작은 창으로 재생, 마우스로 위치를 옮길 수 있음
//     "저널이름" : 반드시 따옴표로 감싸서 적습니다.
//          지정하면 캐릭터 저널 편집 권한이 있는 사람에게만 영상을 보여줄 수 있습니다.
//          생략시 모두에게 재생됩니다.
//          이름에 띄어쓰기가 섞여 있어도 따옴표 안에 저널 이름을 넣으면
//          첫 글자가 겹치는 다른 저널이 있어도 따옴표로 감싸 넘기기 때문에 정확히 구분됩니다.
//
// =============================================

var CUTSCENE_DEFAULT_LEAD_SEC = 0;
var CUTSCENE_DEFAULT_MODE = 'full';

// 채팅에 뜨는 안내 문구의 스타일 — 여기 값만 바꾸면 디자인이 바뀜
var CUTSCENE_MESSAGE_STYLE = {
  container: 'padding:6px 10px;background:#2b2b2b;border-radius:6px;',
  text: 'font-family:sans-serif;font-size:13px;color:#9ecbff;font-style:italic;'
};

function normalizeName(name){
  return (name || '').replace(/\s+/g, '');
}

function findCharacterByLooseName(rawName){
  var target = normalizeName(rawName);
  return _.find(findObjs({ _type: 'character' }), function (c) {
    return normalizeName(c.get('name')) === target;
  });
}

function buildCueMessage(url, startAt, mode){
  return '<div style="' + CUTSCENE_MESSAGE_STYLE.container + '">' +
    '<a href="' + url + '" target="_blank" style="' + CUTSCENE_MESSAGE_STYLE.text + 'text-decoration:none;">🎬 Playing a video · · ·</a>' +
    '<span style="display:none">CUE|' + url + '|' + startAt + '|' + mode + '</span>' +
    '</div>';
}

function buildTimingPhrase(leadSec){
  return leadSec > 0 ? (leadSec + '초 뒤 영상을 시청합니다.') : '영상을 시청합니다.';
}

function parseCutArgs(rest){
  var targetRaw = null;
  var targetMatch = rest.match(/,\s*"([^"]*)"\s*$/);
  if (targetMatch){
    targetRaw = targetMatch[1];
    rest = rest.slice(0, targetMatch.index);
  }

  var parts = rest.split(',').map(function (s) { return s.trim(); });
  return {
    url: parts[0],
    leadSec: parts[1] ? parseFloat(parts[1]) : CUTSCENE_DEFAULT_LEAD_SEC,
    mode: (parts[2] === 'full' || parts[2] === 'map' || parts[2] === 'window') ? parts[2] : CUTSCENE_DEFAULT_MODE,
    targetRaw: targetRaw
  };
}

on('chat:message', function (msg) {
  if (msg.type !== 'api') return;

  var cmdMatch = msg.content.match(/^!컷\s+(.+)$/);
  if (!cmdMatch) return;
  if (!playerIsGM(msg.playerid)) return;

  var args = parseCutArgs(cmdMatch[1]);
  if (!args.url){
    sendChat('System', '/w gm 사용법: !컷 ?{영상 링크(확장자 포함)|}, ?{대기시간|}, ?{모드|full|map|window}, "?{저널이름|}"');
    return;
  }

  var startAt = Date.now() + Math.round(args.leadSec * 1000);
  var cueMessage = buildCueMessage(args.url, startAt, args.mode);

  if (args.targetRaw){
    var targetChar = findCharacterByLooseName(args.targetRaw);
    if (!targetChar){
      sendChat('System', '/w gm "' + args.targetRaw + '"라는 이름의 캐릭터를 못 찾았습니다.');
      return;
    }
    sendChat('System', '/w "' + targetChar.get('name') + '" ' + cueMessage);
    sendChat('System', '/w gm "' + targetChar.get('name') + '"이(가) ' + args.mode + ' 모드로 ' + buildTimingPhrase(args.leadSec));
  } else {
    sendChat('', '/desc ' + cueMessage);
    sendChat('System', '/w gm 전원 ' + args.mode + ' 모드로 ' + buildTimingPhrase(args.leadSec));
  }
});
