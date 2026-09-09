/**
 * Roll20 Portrait Album
 * -----------------------------------------------------------
 * 명령어 요약
 *   !!얼굴등록 <캐릭터이름>              (GM) 같은 이름의 롤테이블에서 아바타(얼굴) 일괄 등록
 *   !!스탠딩등록 <캐릭터이름>            (GM) 같은 이름의 카드덱에서 토큰(스탠딩) 일괄 등록
 *   !!얼굴스탠딩등록 <캐릭터이름>        (GM) 롤테이블 얼굴 + 카드덱 스탠딩을 한 번에 등록
 *   !!얼굴목록 <캐릭터이름> <3|4>        (GM) 등록된 표정을 3열/4열 카드형 핸드아웃으로 정리
 *   !!표정초기화                         (GM) 등록된 표정 기록을 전부 삭제
 *   !@표정이름                           대사 없이 표정만 조용히 전환 (예: !@화남)
 *   !@기본                               최초 저널 아바타/대표 토큰으로 복원
 *   <대사내용> @<표정이름>                대사 치면서 표정도 같이 전환 (예: 안녕하세요 @화남)
 * -----------------------------------------------------------
 *
 * !!얼굴등록 <캐릭터이름>   (GM 전용)
 *   캐릭터 이름과 똑같은 이름의 롤테이블(Rollable Table)을 찾아서, 그
 *   안의 각 항목 이름을 표정 이름으로, 항목에 등록된 이미지를 그 표정의
 *   아바타(얼굴) 이미지로 등록합니다. 이미 등록된 토큰(스탠딩) 값은
 *   그대로 유지되고 아바타만 갱신/추가됩니다.
 *
 * !!스탠딩등록 <캐릭터이름>   (GM 전용)
 *   캐릭터 이름과 똑같은 이름의 카드덱을 찾아서, 그 안의 각 카드 이름을
 *   표정 이름으로, 카드에 등록된 이미지를 그 표정의 토큰(스탠딩) 이미지로
 *   등록합니다. 이미 등록된 아바타(얼굴) 값은 그대로 유지되고 토큰만
 *   갱신/추가됩니다.
 *   두 명령어 모두 이미지는 반드시 롤20 라이브러리에 업로드된 것이어야
 *   합니다(외부 URL은 롤20 API가 거부합니다).
 *
 *
 * !!얼굴스탠딩등록 <캐릭터이름>   (GM 전용)
 *   같은 이름의 롤테이블과 카드덱을 한 번에 확인합니다.
 *   롤테이블 항목은 얼굴(avatar), 카드덱 카드는 스탠딩(token)으로 등록합니다.
 *   같은 표정 이름이 양쪽에 있으면 하나의 표정 데이터에 얼굴+스탠딩이 함께
 *   저장됩니다. 둘 중 하나만 존재해도 있는 쪽은 등록하며, 둘 다 없을 때만
 *   오류를 표시합니다.
 *
 * !!얼굴목록 <캐릭터이름> <3|4>   (GM 전용)
 *   지정한 캐릭터의 등록 표정을 사진 위 / 표정 이름 아래 형태의 카드로
 *   정리합니다. 마지막 숫자는 한 줄에 표시할 카드 수(3 또는 4)입니다.
 *   결과는 "캐릭터이름 표정 목록" 핸드아웃에 저장되며, 다시 실행하면
 *   최신 내용으로 갱신됩니다. 예: !!얼굴목록 홍길동 4
 *
 * !!표정초기화   (GM 전용)
 *   지금까지 등록된 모든 캐릭터의 표정 기록을 전부 삭제합니다(되돌릴 수
 *   없습니다). 최초 저널 아바타/대표 토큰(@기본) 기록은 남아있습니다.
 *
 * !@표정이름
 *   대사 없이 표정만 조용히 전환합니다. "!"로 시작해서 롤20이 이 메시지
 *   자체는 아무에게도 안 보여줍니다. 화자는 채팅창 하단의 "말하는 사람으로
 *   (Speaking as)"에 선택된 캐릭터로 자동 인식됩니다. 예: !@화남
 *   짝을 이루는 "Roll20 Portrait Camera" 템퍼몽키를 설치해두면, 대사 없이
 *   "@화남"만 쳐도 자동으로 이 형태로 바뀌어서 전송됩니다.
 *
 * !@기본
 *   그 캐릭터가 표정 전환되기 전, 최초의 저널 아바타/대표 토큰으로
 *   되돌립니다(첫 표정 전환 시 자동으로 저장해둔 값).
 *
 * <대사내용> @<표정이름>
 *   평범한 대사 끝에 "@표정이름"을 붙여서 보내면(예: "안녕하세요 @화남"),
 *   메시지는 그대로 채팅에 남고(태그 포함, 안 지워짐 — 이미 보내진
 *   메시지는 API가 사후에 숨길 수 없기 때문) 화자의 아바타/토큰만
 *   조용히 그 표정으로 바뀝니다. 화자도 "말하는 사람으로" 선택된
 *   캐릭터 기준으로 자동 인식됩니다. 등록 안 된 표정이면 아무 변화
 *   없이 메시지만 그대로 남습니다.
 */

function normalizeName(name){
  return (name || '').replace(/\s+/g, '');
}

function findCharacterByLooseName(rawName){
  var target = normalizeName(rawName);
  return _.find(findObjs({ _type: 'character' }), function (c) {
    return normalizeName(c.get('name')) === target;
  });
}

// 채팅 메시지의 msg.who("말하는 사람으로" 선택된 이름)로 캐릭터를 찾음.
// "PlayerName (Character Name)" 형태로 올 때가 있어 괄호 앞부분만 사용.
function findCharacterByWho(who){
  if (!who) return null;
  var name = who.replace(/\s*\(.*\)\s*$/, '').trim();
  return findCharacterByLooseName(name);
}

function getExpressionStore(){
  if (!state.ExpressionSwitcher) state.ExpressionSwitcher = {};
  return state.ExpressionSwitcher;
}

function getCharExpressions(charId){
  var store = getExpressionStore();
  if (!store[charId]) store[charId] = {};
  return store[charId];
}

// 캐릭터가 처음 표정 전환될 때의 저널 아바타/대표 토큰 이미지를 기본값으로 보관
function getDefaultLookStore(){
  if (!state.ExpressionSwitcherDefaults) state.ExpressionSwitcherDefaults = {};
  return state.ExpressionSwitcherDefaults;
}

function saveDefaultLook(character, force){
  var store = getDefaultLookStore();
  if (store[character.id] && !force) return store[character.id];

  var tokens = findTokensForCharacter(character);
  var firstToken = tokens.length ? tokens[0] : null;

  store[character.id] = {
    avatar: character.get('avatar') || '',
    token: firstToken ? (firstToken.get('imgsrc') || '') : ''
  };

  return store[character.id];
}

// 현재 보고 있는 페이지에서, 이 캐릭터를 대표하는 토큰 전부를 찾음
function findTokensForCharacter(character){
  var pageId = Campaign().get('playerpageid');
  return findObjs({
    _type: 'graphic',
    _pageid: pageId,
    represents: character.id
  });
}

function applyExpression(character, exprName){
  // 최초 전환 직전의 저널 아바타/대표 토큰을 기본값으로 1회 저장
  saveDefaultLook(character, false);

  // @기본은 일반 표정 등록과 무관하게 최초 기본값으로 복원
  if (exprName === '기본') {
    var defaults = getDefaultLookStore()[character.id];
    if (!defaults) return false;

    if (defaults.avatar) character.set('avatar', defaults.avatar);
    if (defaults.token) {
      _.each(findTokensForCharacter(character), function (token) {
        token.set('imgsrc', defaults.token);
      });
    }
    return true;
  }

  var expressions = getCharExpressions(character.id);
  var look = expressions[exprName];
  if (!look) return false;

  if (look.avatar) character.set('avatar', look.avatar);
  if (look.token) {
    _.each(findTokensForCharacter(character), function (token) {
      token.set('imgsrc', look.token);
    });
  }
  return true;
}

function escapeHandoutHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

on('chat:message', function (msg) {
  if (msg.type !== 'api') return;

  // ---- !!얼굴스탠딩등록 : 롤테이블 얼굴 + 카드덱 스탠딩을 한 번에 등록 ----
  var bothMatch = msg.content.match(/^!!얼굴스탠딩등록\s+(.+)$/);
  if (bothMatch) {
    if (!playerIsGM(msg.playerid)) return;

    var bCharName = bothMatch[1].trim();
    var bCharacter = findCharacterByLooseName(bCharName);
    if (!bCharacter) {
      sendChat('System', '/w gm "' + bCharName + '"라는 이름의 캐릭터를 못 찾았습니다.');
      return;
    }

    // 현재 저널 기본 얼굴/대표 토큰은 최초 1회 보관
    saveDefaultLook(bCharacter, false);

    var bTargetName = normalizeName(bCharacter.get('name'));
    var bExpressions = getCharExpressions(bCharacter.id);

    var bTable = _.find(findObjs({ _type: 'rollabletable' }), function (t) {
      return normalizeName(t.get('name')) === bTargetName;
    });

    var bDeck = _.find(findObjs({ _type: 'deck' }), function (d) {
      return normalizeName(d.get('name')) === bTargetName;
    });

    if (!bTable && !bDeck) {
      sendChat('System', '/w gm "' + bCharacter.get('name') + '"와 이름이 같은 롤테이블/카드덱을 모두 찾지 못했습니다.');
      return;
    }

    var bFaceCount = 0;
    var bStandCount = 0;

    if (bTable) {
      _.each(findObjs({ _type: 'tableitem', _rollabletableid: bTable.id }), function (item) {
        var itemName = item.get('name');
        var itemImg = item.get('avatar');
        if (!itemName || !itemImg) return;

        if (!bExpressions[itemName]) bExpressions[itemName] = {};
        bExpressions[itemName].avatar = itemImg;
        bFaceCount++;
      });
    }

    if (bDeck) {
      _.each(findObjs({ _type: 'card', _deckid: bDeck.id }), function (card) {
        var cardName = card.get('name');
        var cardImg = card.get('avatar');
        if (!cardName || !cardImg) return;

        if (!bExpressions[cardName]) bExpressions[cardName] = {};
        bExpressions[cardName].token = cardImg;
        bStandCount++;
      });
    }

    sendChat(
      'System',
      '/w gm "' + bCharacter.get('name') + '" 등록 완료 — 얼굴 ' +
      bFaceCount + '개 / 스탠딩 ' + bStandCount + '개'
    );
    return;
  }

  // ---- !!얼굴등록 : 캐릭터 이름과 같은 이름의 롤테이블에서 항목 이름=표정
  // 이름, 항목 이미지=아바타(얼굴) 이미지로 등록. 기존 토큰 값은 유지됨 ----
  var faceMatch = msg.content.match(/^!!얼굴등록\s+(.+)$/);
  if (faceMatch) {
    if (!playerIsGM(msg.playerid)) return;

    var fCharName = faceMatch[1].trim();
    var fCharacter = findCharacterByLooseName(fCharName);
    if (!fCharacter) {
      sendChat('System', '/w gm "' + fCharName + '"라는 이름의 캐릭터를 못 찾았습니다.');
      return;
    }

    var fTargetName = normalizeName(fCharacter.get('name'));
    var fTable = _.find(findObjs({ _type: 'rollabletable' }), function (t) {
      return normalizeName(t.get('name')) === fTargetName;
    });
    if (!fTable) {
      sendChat('System', '/w gm "' + fCharacter.get('name') + '"와 이름이 같은 롤테이블을 못 찾았습니다.');
      return;
    }

    // 얼굴을 가져오기 전에 현재 저널의 기본 아바타/대표 토큰을 최초 1회 저장합니다.
    // 이후 표정 전환으로 저널 아바타가 바뀌어도 '기본' 얼굴은 유지됩니다.
    saveDefaultLook(fCharacter, false);

    var fExpressions = getCharExpressions(fCharacter.id);
    var faceCount = 0;
    _.each(findObjs({ _type: 'tableitem', _rollabletableid: fTable.id }), function (item) {
      var itemName = item.get('name');
      var itemImg = item.get('avatar');
      if (!itemName || !itemImg) return;
      if (!fExpressions[itemName]) fExpressions[itemName] = {};
      fExpressions[itemName].avatar = itemImg;
      faceCount++;
    });

    sendChat('System', '/w gm "' + fCharacter.get('name') + '"에 얼굴(아바타) ' + faceCount + '개를 롤테이블에서 가져왔습니다.');
    return;
  }

  // ---- !!스탠딩등록 : 캐릭터 이름과 같은 이름의 카드덱에서 카드 이름=표정
  // 이름, 카드 이미지=토큰(스탠딩) 이미지로 등록. 기존 아바타 값은 유지됨 ----
  var standMatch = msg.content.match(/^!!스탠딩등록\s+(.+)$/);
  if (standMatch) {
    if (!playerIsGM(msg.playerid)) return;

    var stCharName = standMatch[1].trim();
    var stCharacter = findCharacterByLooseName(stCharName);
    if (!stCharacter) {
      sendChat('System', '/w gm "' + stCharName + '"라는 이름의 캐릭터를 못 찾았습니다.');
      return;
    }

    var stTargetName = normalizeName(stCharacter.get('name'));
    var stDeck = _.find(findObjs({ _type: 'deck' }), function (d) {
      return normalizeName(d.get('name')) === stTargetName;
    });
    if (!stDeck) {
      sendChat('System', '/w gm "' + stCharacter.get('name') + '"와 이름이 같은 카드덱을 못 찾았습니다.');
      return;
    }

    var stExpressions = getCharExpressions(stCharacter.id);
    var standCount = 0;
    _.each(findObjs({ _type: 'card', _deckid: stDeck.id }), function (card) {
      var cardName = card.get('name');
      var cardImg = card.get('avatar');
      if (!cardName || !cardImg) return;
      if (!stExpressions[cardName]) stExpressions[cardName] = {};
      stExpressions[cardName].token = cardImg;
      standCount++;
    });

    sendChat('System', '/w gm "' + stCharacter.get('name') + '"에 스탠딩(토큰) ' + standCount + '개를 카드덱에서 가져왔습니다.');
    return;
  }

  // ---- !!표정초기화 : 등록된 표정 기록 전체 삭제 ----
  var resetMatch = msg.content.match(/^!!표정초기화$/);
  if (resetMatch) {
    if (!playerIsGM(msg.playerid)) return;

    var charCount = _.keys(getExpressionStore()).length;
    state.ExpressionSwitcher = {};

    sendChat('System', '/w gm 등록된 표정 기록을 전부 삭제했습니다. (캐릭터 ' + charCount + '명분)');
    return;
  }

  // ---- !!얼굴목록 캐릭터이름 3/4 : 해당 캐릭터 표정을 카드형 그리드로 정리 ----
  var handoutMatch = msg.content.match(/^!!얼굴목록\s+(.+?)\s+([34])$/);
  if (handoutMatch) {
    if (!playerIsGM(msg.playerid)) return;

    var hCharName = handoutMatch[1].trim();
    var columns = Number(handoutMatch[2]);
    var hCharacter = findCharacterByLooseName(hCharName);

    if (!hCharacter) {
      sendChat('System', '/w gm "' + hCharName + '"라는 이름의 캐릭터를 못 찾았습니다.');
      return;
    }

    var hExpressions = getCharExpressions(hCharacter.id);
    var cards = [];

    // 얼굴 목록에는 저널 기본 얼굴 + 롤테이블에서 등록된 얼굴만 표시합니다.
    // !!스탠딩등록으로 카드덱에서 들어온 token 전용 이미지는 제외합니다.
    var defaults = getDefaultLookStore()[hCharacter.id];
    var defaultAvatar = defaults && defaults.avatar
      ? defaults.avatar
      : (hCharacter.get('avatar') || '');

    if (defaultAvatar) {
      cards.push({
        name: '기본',
        image: defaultAvatar
      });
    }

    _.each(hExpressions, function (look, exprName) {
      // avatar가 있는 항목만 얼굴/표정 목록에 표시
      if (!look || !look.avatar) return;
      cards.push({
        name: exprName,
        image: look.avatar
      });
    });

    var rows = '';
    if (!cards.length) {
      rows = '<tr><td style="padding:16px;text-align:center;">등록된 표정이 없습니다.</td></tr>';
    } else {
      for (var i = 0; i < cards.length; i += columns) {
        rows += '<tr>';
        for (var c = 0; c < columns; c++) {
          var card = cards[i + c];
          if (!card) {
            rows += '<td style="width:' + (100 / columns) + '%;padding:8px;"></td>';
            continue;
          }

          var imageHtml = card.image
            ? '<img src="' + escapeHandoutHtml(card.image) + '" style="display:block;width:100%;max-width:140px;height:auto;margin:0 auto 6px auto;">'
            : '<div style="width:140px;height:140px;line-height:140px;margin:0 auto 6px auto;background:#eee;color:#888;text-align:center;">이미지 없음</div>';

          rows += '<td style="width:' + (100 / columns) + '%;padding:8px;text-align:center;vertical-align:top;">' +
            imageHtml +
            '<div style="font-weight:bold;text-align:center;">' + escapeHandoutHtml(card.name) + '</div>' +
          '</td>';
        }
        rows += '</tr>';
      }
    }

    var gridHtml = '<table style="border-collapse:collapse;width:100%;table-layout:fixed;">' + rows + '</table>';
    var handoutName = hCharacter.get('name') + ' 표정 목록';
    var handout = _.find(findObjs({ _type: 'handout' }), function (h) {
      return h.get('name') === handoutName;
    });

    if (!handout) {
      handout = createObj('handout', { name: handoutName, inplayerjournals: 'all' });
    }

    handout.set('notes', gridHtml);

    sendChat('System', '/w gm "' + handoutName + '" 핸드아웃을 ' + columns + '열로 정리했습니다.');
    return;
  }

  // 잘못된 형식 안내
  if (/^!!얼굴목록(?:\s|$)/.test(msg.content)) {
    if (!playerIsGM(msg.playerid)) return;
    sendChat('System', '/w gm 사용법: !!얼굴목록 캐릭터이름 3 또는 !!얼굴목록 캐릭터이름 4');
    return;
  }

  // ---- !@표정이름 : 대사 없이 표정만 조용히 전환, 화자는 자동 인식 ----
  var silentMatch = msg.content.match(/^!@(\S+)$/);
  if (silentMatch) {
    var sExprName = silentMatch[1].trim();
    var sSpeaker = findCharacterByWho(msg.who);
    if (!sSpeaker) {
      sendChat('System', '/w gm 지금 "말하는 사람으로(Speaking as)" 선택된 캐릭터를 못 찾았습니다.');
      return;
    }
    if (!applyExpression(sSpeaker, sExprName)) {
      sendChat('System', '/w gm "' + sSpeaker.get('name') + '"에 "' + sExprName + '" 표정이 등록되어 있지 않습니다.');
    }
    return;
  }
});


on('chat:message', function (msg) {
  if (msg.type !== 'general') return;

  var tagMatch = (msg.content || '').match(/@(\S+)\s*$/);
  if (!tagMatch) return;

  var speaker = findCharacterByWho(msg.who);
  if (!speaker) return;

  applyExpression(speaker, tagMatch[1]);
});
