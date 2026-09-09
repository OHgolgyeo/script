// =============================================
// Roll20 Journal Token API - CoC
// -----------------------------------------------------------
//
// ⚠ 중요
//     "개요 및 정보(Bio)" 필드를 감시합니다.
//     처리가 완료된 스크립트는 자동으로 삭제가 됩니다.
//     내용을 다시 입력하면 수정이 됩니다.
//     불러오는 것: 이름, 특성치, 체력, 마력, 행운, 이동력, 체구, 기능치, 전투
//     무기 데이터는 이름,기능,피해량,추가피해,사거리,횟수,탄약,(고장은 빈칸으로), \n"}}으로 내용을 포함시키세요.
//     저격(라/산)> 라이플, 기타는 근접전으로 추가되며 최대 탄약은 직접 입력해야 합니다.
//     적용이 안 된다면 다른 영역을 클릭 후 저장해주세요.
//
// 사용법:
//   1. GM이 채팅에 "!importstart" 입력 → 수신 대기 시작
//      → GM에게 귓속말로 "수신 시작" 알림
//   2. 플레이어가 자기 캐릭터 저널의 "개요 및 정보 > Bio"에
//      코코포리아 캐릭터 JSON을 붙여넣고 저장
//      → 저장하는 순간 자동으로 파싱되어 시트에 채워짐
//      → GM에게 "누구 시트가 업데이트됐는지" 귓속말로 알림
//   3. 준비시간이 끝나면 GM이 "!importend" 입력 → 수신 종료
//      (세션 중 오작동 방지)
//
// =============================================

on('ready', function () {
  if (!state.CcfoliaImporter) {
    state.CcfoliaImporter = {
      active: false
    };
  }
  log('Ccfolia Character Importer ready.');
});

// =============================================================
// 유틸리티
// =============================================================
function stripRichText(raw) {
  if (!raw) return '';
  var text = decodeURIComponent(raw);
  text = text.replace(/<[^>]*>/g, '');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.trim();
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function setAttr(characterId, name, value) {
  var existing = findObjs({ _type: 'attribute', _characterid: characterId, name: name });
  var obj;
  if (existing.length > 1) {
    obj = existing[0];
    for (var i = 1; i < existing.length; i++) {
      existing[i].remove();
    }
  } else if (existing.length === 1) {
    obj = existing[0];
  }
  if (obj) {
    obj.set('current', value);
  } else {
    createObj('attribute', { name: name, current: value, characterid: characterId });
  }
}

// =============================================================
// CoC7 (크툴루의 부름 7판) 라벨/필드 매핑
// 라벨은 Roll20 공식 Call_of_Cthulhu_7th_Ed 시트의
// translations/ko.json 기준으로 검증된 값입니다.
// =============================================================
var COC7_CHAR_MAP = {
  '근력': 'str',
  '건강': 'con',
  '크기': 'siz',
  '민첩': 'dex',
  '민첩성': 'dex',
  '외모': 'app',
  '지능': 'int',
  '지능(아이디어)': 'int',
  '정신': 'pow',
  '정신력': 'pow',
  '교육': 'edu'
};

// params 배열 라벨 매핑
var COC7_PARAM_MAP = {
  '이동력': 'mov',
  '체구': 'build',
  'DB': 'damage_bonus'
};

// status 배열 라벨 매핑
var COC7_STATUS_MAP = {
  'HP': { current: 'hp' },
  'MP': { current: 'mp' },
  'SAN': { current: 'san' },
  '이성': { current: 'san' },
  '행운': { current: 'luck' },
  '운': { current: 'luck' }
};

// status 라벨은 공백 오차만 허용하는 완전 일치 매칭을 사용합니다.
// (문자열 부분매치가 아니므로 '운' 키가 다른 라벨을 잘못 먹을 일은 없습니다.)
function lookupStatus(label) {
  var trimmed = (label || '').trim();
  return COC7_STATUS_MAP[trimmed] || null;
}

var COC7_SKILL_MAP = {
  '감정': 'appraise',
  '고고학': 'archaeology',
  '관찰': 'spot_hidden',
  '관찰력': 'spot_hidden',
  '근접전(격투)': 'fighting_brawl',
  '기계수리': 'mech_repair',
  '도약': 'jump',
  '듣기': 'listen',
  '말재주': 'fast_talk',
  '매혹': 'charm',
  '법률': 'law',
  '변장': 'disguise',
  '사격(권총)': 'firearms_handgun',
  '사격(라/산)': 'firearms_rifle',
  '설득': 'persuade',
  '손놀림': 'sleight_of_hand',
  '수영': 'swim',
  '승마': 'ride',
  '심리학': 'psychology',
  '언어(모국어)': 'language_own',
  '모국어': 'language_own',
  '역사': 'history',
  '열쇠공': 'locksmith',
  '오르기': 'climb',
  '오컬트': 'occult',
  '위협': 'intimidate',
  '은밀행동': 'stealth',
  '응급처치': 'firstaid',
  '의료': 'medicine',
  '인류학': 'anthropology',
  '자동차 운전': 'drive_auto',
  '자료조사': 'library_use',
  '자연': 'natural_world',
  '재력': 'credit_rating',
  '전기수리': 'elec_repair',
  '정신분석': 'psychoanalysis',
  '중장비 조작': 'op_hv_machine',
  '추적': 'track',
  '크툴루 신화': 'cthulhu_mythos',
  '투척': 'throw',
  '항법': 'navigate',
  '회계': 'accounting',
  '회피': 'dodge',
  '예술/공예': 'artandcraft',
  '컴퓨터 사용': 'computeruse'
};

function normalizeLabel(label) {
  return label.replace(/[()/:：\s]/g, '');
}

var COC7_CHAR_MAP_NORMALIZED = {};
_.each(COC7_CHAR_MAP, function (attr, label) {
  COC7_CHAR_MAP_NORMALIZED[normalizeLabel(label)] = attr;
});

function lookupChar(label) {
  if (COC7_CHAR_MAP[label]) return COC7_CHAR_MAP[label];
  var normalized = normalizeLabel(label);
  if (COC7_CHAR_MAP_NORMALIZED[normalized]) return COC7_CHAR_MAP_NORMALIZED[normalized];
  return null;
}

var COC7_SKILL_MAP_NORMALIZED = {};
_.each(COC7_SKILL_MAP, function (attr, label) {
  COC7_SKILL_MAP_NORMALIZED[normalizeLabel(label)] = attr;
});

function lookupSkill(label) {
  if (COC7_SKILL_MAP[label]) return COC7_SKILL_MAP[label];
  var normalized = normalizeLabel(label);
  if (COC7_SKILL_MAP_NORMALIZED[normalized]) return COC7_SKILL_MAP_NORMALIZED[normalized];
  return null;
}

var COC7_CUSTOM_SKILL_SLOTS = [
  'otherskill1', 'otherskill2', 'otherskill3', 'otherskill4', 'otherskill5', 'otherskill6'
];

var COC7_WEAPON_SLOTS = ['weapon1', 'weapon2', 'weapon3'];

var COC7_WEAPON_CATEGORIES = {
  hth: 6, // 근접(Hand-to-Hand)
  hgun: 6, // 권총(Handgun)
  rifle: 6, // 라이플(Rifle)
  shotgun: 6, // 샷건(Shotgun)
  automatic: 6, // 자동화기(Automatic)
  explhv: 6, // 폭발물/중화기(Explosive/Heavy)
  misc: 8 // 기타(Miscellaneous)
};

function guessWeaponCategory(name) {
  return 'misc';
}

var COC7_SKILL_TO_WEAPON_CATEGORY = {
  fighting_brawl: 'hth',
  firearms_handgun: 'hgun',
  firearms_rifle: 'rifle'
};

function categorizeBySkill(skillAttr) {
  return COC7_SKILL_TO_WEAPON_CATEGORY[skillAttr] || null;
}

var COC7_WEAPON_SKIP_NAMES = ['비무장', 'unarmed', 'Unarmed'];

function tryParseStructuredWeaponLine(line) {
  var parts = line.split(/[,\/|.]/).map(function (p) { return p.trim(); });
  if (parts.length !== 8) return null;
  return {
    name: parts[0],
    skill: parts[1],
    damage: parts[2],
    dbRaw: parts[3],
    range: parts[4],
    attacks: parts[5],
    ammo: parts[6],
    malf: parts[7]
  };
}

function parseDbOption(raw) {
  var t = (raw || '').replace(/[＋+]/g, '').trim();
  if (/^(1\/2|½)db$/i.test(t)) return '+round((@{damage_bonus})/2)';
  if (/^db$/i.test(t)) return '+@{damage_bonus}';
  return '+0';
}

function parseCoC7Commands(commandsText, paramLookup) {
  var result = { skills: [], customSkills: [], abilities: [], weapons: [] };
  if (!commandsText) return result;

  var lines = commandsText.split('\n');
  var nextCustomSlot = 0;

  _.each(lines, function (rawLine) {
    var line = rawLine.trim();
    if (!line) return;

    if (/^cc<=\{.+?\}/i.test(line)) {
      return;
    }

    var skillMatch = line.match(/^CC(\([+-]?\d+\))?\s*<=\s*(\d+)\s+(.+)$/i);
    if (skillMatch) {
      var value = parseInt(skillMatch[2], 10);
      var label = skillMatch[3].trim();

      if (lookupChar(label)) {
        result.skills.push({ attr: lookupChar(label), value: value });
        return;
      }

      var mappedSkill = lookupSkill(label);
      if (mappedSkill) {
        result.skills.push({ attr: mappedSkill, value: value });
        return;
      }

      if (nextCustomSlot < COC7_CUSTOM_SKILL_SLOTS.length) {
        result.customSkills.push({
          attr: COC7_CUSTOM_SKILL_SLOTS[nextCustomSlot],
          label: label,
          value: value
        });
        nextCustomSlot++;
      } else {
        log('CcfoliaImporter: 커스텀 스킬 슬롯 초과 - "' + label + '" 무시됨');
      }
      return;
    }

    if (!/\d/.test(line)) {
      return;
    }

    var structured = tryParseStructuredWeaponLine(line);
    if (structured) {
      var skillAttr = lookupChar(structured.skill) || lookupSkill(structured.skill);
      result.weapons.push({
        name: structured.name,
        damage: structured.damage,
        skill: skillAttr || undefined, // select 옵션 값과 맞추기 위해 @{} 없이 속성 이름 그대로
        db: parseDbOption(structured.dbRaw),
        range: structured.range || undefined,
        attacks: structured.attacks || undefined,
        ammo: structured.ammo || undefined,
        malf: structured.malf ? (structured.malf.match(/\d+/) || [])[0] : undefined,
        category: categorizeBySkill(skillAttr) || 'misc'
      });
      return;
    }

    var abilityText = line;
    var nameGuess = line.replace(/^[\d+\-*/{}a-zA-Z]+\s+/, '').trim() || line;

    _.each(paramLookup, function (attrName, koLabel) {
      var re = new RegExp('\\{' + koLabel + '\\}', 'g');
      abilityText = abilityText.replace(re, '@{' + attrName + '}');
    });

    _.each(COC7_STATUS_MAP, function (map, koLabel) {
      var re = new RegExp('\\{' + koLabel + '\\}', 'g');
      abilityText = abilityText.replace(re, '@{' + map.current + '}');
    });

    result.abilities.push({ name: nameGuess.substring(0, 50), action: '/roll ' + abilityText });

    var weaponMatch = line.match(/^(\S+)\s+(.+)$/);
    if (weaponMatch) {
      var wpnName = weaponMatch[2].trim();
      var isSkipped = _.some(COC7_WEAPON_SKIP_NAMES, function (skip) {
        return wpnName.toLowerCase() === skip.toLowerCase();
      });
      if (!isSkipped) {
        var readableDamage = weaponMatch[1].replace(/\{db\}/gi, 'DB').replace(/\{(.+?)\}/g, '$1');
        result.weapons.push({ name: wpnName, damage: readableDamage, category: 'hth' });
      }
    }
  });

  return result;
}

// =============================================================
// Core: 데이터 적용
// =============================================================
function applyCharacterData(character, jsonData) {
  if (!jsonData || jsonData.kind !== 'character' || !jsonData.data) {
    return;
  }

  var data = jsonData.data;
  var attrsToSet = {}; // {attrName: value} - 전부 Attribute 객체로 만들 값들
  var weaponSlotCounter = {}; // 카테고리별로 이번 처리에서 몇 번째 슬롯까지 썼는지

  // status (HP/MP/SAN/행운·운) — max 필드는 시트가 능력치로부터 자동 계산하므로 current만 반영
  _.each(data.status || [], function (s) {
    var map = lookupStatus(s.label);
    if (!map) return;
    if (typeof s.value !== 'undefined') attrsToSet[map.current] = s.value;
  });

  // params (이동력/체구/DB 등)
  var paramLookup = {}; // {한글라벨: attrName} - commands 파서에서 {db} 치환용
  _.each(data.params || [], function (p) {
    var attr = COC7_PARAM_MAP[p.label];
    if (!attr) return;
    attrsToSet[attr] = p.value;
    paramLookup[p.label] = attr;
  });

  // 이름은 Attribute가 아니라 Character 객체 자체의 속성이라 따로 처리
  if (data.name) character.set('name', data.name);

  if (typeof data.initiative !== 'undefined') attrsToSet['initiative'] = data.initiative;

  // commands (스킬/무기 등)
  var parsed = parseCoC7Commands(data.commands, paramLookup);

  _.each(parsed.skills, function (s) {
    attrsToSet[s.attr] = s.value;
  });

  _.each(parsed.customSkills, function (s) {
    attrsToSet[s.attr] = s.value;
    attrsToSet[s.attr + '_name'] = s.label; // 커스텀 슬롯 이름칸
  });

  _.each(parsed.weapons, function (w, idx) {
    if (idx < COC7_WEAPON_SLOTS.length) {
      var slot = COC7_WEAPON_SLOTS[idx];
      attrsToSet[slot + '_name'] = w.name;
      attrsToSet[slot + '_damage'] = w.damage;
    }

    // 신버전 Combat 섹션
    var category = w.category || guessWeaponCategory(w.name);
    var maxSlots = COC7_WEAPON_CATEGORIES[category];
    var used = weaponSlotCounter[category] || 0;

    if (used < maxSlots) {
      var slotNum = used + 1;
      var prefix = category + '_weapon' + slotNum;

      attrsToSet[prefix + '_name'] = w.name;
      attrsToSet[prefix + '_damage'] = w.damage;
      if (typeof w.skill !== 'undefined') attrsToSet[prefix + '_skill'] = w.skill;
      if (typeof w.db !== 'undefined') attrsToSet[prefix + '_db'] = w.db;
      if (w.range) attrsToSet[prefix + '_range'] = w.range;
      if (w.attacks) attrsToSet[prefix + '_attacks'] = w.attacks;
      if (w.malf) attrsToSet[prefix + '_malf'] = w.malf;
      if (w.ammo && /^\d+$/.test(w.ammo)) {
        attrsToSet[prefix + '_ammo'] = w.ammo;
        attrsToSet[prefix + '_ammo_max'] = w.ammo;
        attrsToSet[prefix + '_ammo_checkbox'] = 1;
      }

      weaponSlotCounter[category] = slotNum;
    }
  });

  // Character.set()이 아니라 Attribute 객체 단위로 하나씩 생성/갱신
  _.each(attrsToSet, function (value, name) {
    setAttr(character.id, name, value);
  });

  _.each(parsed.abilities, function (ab) {
    createObj('ability', {
      characterid: character.id,
      name: ab.name,
      action: ab.action,
      istokenaction: false
    });
  });

  // 누구의 시트가 업데이트됐는지 GM에게 귓속말로 알림
  sendChat('System', '/w gm "' + (data.name || character.get('name')) +
    '" 캐릭터 데이터를 적용했습니다. (스킬 ' + parsed.skills.length +
    '개, 커스텀 스킬 ' + parsed.customSkills.length +
    '개, 무기 ' + parsed.weapons.length +
    '개, 매크로 ' + parsed.abilities.length + '개)');
}

// =============================================================
// Core: 채팅 명령어 (!importstart / !importend)
// =============================================================
on('chat:message', function (msg) {
  if (msg.type !== 'api') return;

  if (msg.content === '!importstart') {
    if (!playerIsGM(msg.playerid)) return;
    state.CcfoliaImporter.active = true;
    sendChat('System', '/w gm 캐릭터 데이터 수신을 시작합니다.' +
      ' 플레이어는 자기 캐릭터 저널의 "개요 및 정보 > Bio"에 코코포리아 JSON을 붙여넣어주세요.');
    return;
  }

  if (msg.content === '!importend') {
    if (!playerIsGM(msg.playerid)) return;
    state.CcfoliaImporter.active = false;
    sendChat('System', '/w gm 캐릭터 데이터 수신을 종료합니다.');
    return;
  }
});

// =============================================================
// Core: bio 변경 감지 → 자동 적용
// =============================================================
on('change:character:bio', function (obj, prev) {
  if (!state.CcfoliaImporter.active) return;

  obj.get('bio', function (raw) {
    var text = stripRichText(raw);
    if (!text) return;

    var jsonData = safeParseJSON(text);
    if (!jsonData || jsonData.kind !== 'character') return;

    applyCharacterData(obj, jsonData);

    // 처리 완료 후 Bio에 붙여넣은 원본 JSON을 자동으로 비움.
    // bio가 빈 문자열로 변경되면서 change 이벤트가 한 번 더 발생할 수 있지만,
    // 위의 `if (!text) return;` 조건에서 즉시 종료되므로 재처리되지 않음.
    obj.set('bio', '');
  });
});
