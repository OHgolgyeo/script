/*
 * ================================================================
 * Roll20 Portrait Visual Dialogue
 * ================================================================
 *
 * [스탠딩 / Visual Dialogue 명령어]
 *
 * !@숨김
 *   - 현재 표시 중인 Visual Dialogue의 이름/대사 텍스트를 숨깁니다.
 *
 * !@강제숨김
 *   - 표시 중인 스탠딩과 대사 연출을 강제로 정리할 때 사용합니다.
 *
 * !@리셋
 *   - Visual Dialogue의 대사 대기열을 초기화합니다.
 *   - 자동 복구 기능이 있지만, 수동으로 큐를 비워야 할 때 사용할 수 있습니다.
 *
 * /as 캐릭터이름 대사
 *   - 저널에 없는 이름으로 말할 때 사용합니다.
 *   - show_extra_standing=true이면 extra / 엑스트라 / NPC 덱에서
 *     엑스트라용 스탠딩을 찾습니다.
 *
 * ----------------------------------------------------------------
 * [Portrait Album 연동 / 동작이 겹치는 명령]
 * ----------------------------------------------------------------
 *
 * !@표정이름
 *   - Portrait Album에 등록된 해당 캐릭터의 표정/스탠딩으로 변경합니다.
 *   - Portrait Album 자체의 표정 변경 기능과 역할이 겹칩니다.
 *   - Portrait Camera에서 '@표정이름'을 입력하면 자동으로 이 명령 형태로
 *     전달될 수 있으므로 보통 직접 입력할 필요가 없습니다.
 *
 * !@기본
 *   - Portrait Album에 저장된 캐릭터의 기본 스탠딩으로 돌아갑니다.
 *   - Portrait Album의 '@기본' 복원 기능과 역할이 겹칩니다.
 *
 * ※ 위 두 명령은 Portrait Album과 Visual Dialogue가 함께 설치된 경우
 *    같은 표정 전환을 공유하기 위한 연동 명령입니다.
 *
 * ================================================================
 */

// Roll20 Portrait Visual Dialogue
// Based on visual_dialogue.js by original author
// 도움말: https://github.com/kibkibe/roll20-api-scripts/tree/master/visual_dialogue 

// option
const vd_setting = {
max_number: 5,
width: 420,
height: 420,
fit_width: 200,
use_emotion: true,
show_extra_standing: false,
fallback_deck_name: "standings",
extra_deck_aliases: ["extra", "엑스트라", "NPC"],
ignore_list: "GM",
page_list: "conversation,intro",
text_styles: {
  character_default: { name_font_size:18, name_font_color:"rgb(255, 255, 255)", dialogue_font_size:16, dialogue_font_color:"rgb(255, 255, 255)", name_align:"center", dialogue_align:"left" },
  gm: { name_font_size:18, name_font_color:"rgb(255, 255, 255)", dialogue_font_size:16, dialogue_font_color:"rgb(255, 255, 255)", name_align:"center", dialogue_align:"left" },
  desc: { font_size:20, font_color:"rgb(255, 255, 255)", align:"center" }
},
// 캐릭터 이름별 스타일 덮어쓰기 예: "홍길동": { dialogue_font_color:"#ffecec", dialogue_align:"center" }
character_styles: {},
min_showtime: 1000,
showtime_ratio: 20,
line_height: 1.7,
letter_spacing: 0.85,
queue_watchdog_ms: 15000
};



// global constant
state.api_tag = "<a href=\"#vd-permitted-api-chat\"></a>";
state.vd_divider = "ℍ";
state.last_displayed_time = 0;

let vdProcessing = false;
let vdWatchdog = null;
const vdNormalize = v => String(v || '').replace(/\s+/g,'').toLowerCase();
const vdIgnoredSpeaker = name => String(vd_setting.ignore_list || '').split(',').map(s=>s.trim()).filter(Boolean).indexOf(String(name||'').trim()) > -1;
const vdFindExtraDeck = function(){
  const aliases = vd_setting.extra_deck_aliases || ["extra","엑스트라","NPC"];
  const decks = findObjs({_type:'deck'});
  for (let i=0;i<aliases.length;i++) {
    const d = _.find(decks, x => vdNormalize(x.get('name')) === vdNormalize(aliases[i]));
    if (d) return d;
  }
  return null;
};
const vdGetAlbumExpression = (character, emotion) => character && state.ExpressionSwitcher && state.ExpressionSwitcher[character.id] ? state.ExpressionSwitcher[character.id][emotion] || null : null;
const vdGetAlbumDefault = character => character && state.ExpressionSwitcherDefaults ? state.ExpressionSwitcherDefaults[character.id] || null : null;
const vdAlbumStandingUrl = function(character, emotion){
  if (!character) return '';
  if (!vd_setting.use_emotion || emotion === '기본' || !emotion) {
    const d = vdGetAlbumDefault(character);
    if (d && d.token) return d.token;
    if (emotion && vd_setting.use_emotion) { const look=vdGetAlbumExpression(character, emotion); if (look && look.token) return look.token; }
    return '';
  }
  const look = vdGetAlbumExpression(character, emotion);
  if (look && look.token) return look.token;
  const d = vdGetAlbumDefault(character);
  return d && d.token ? d.token : '';
};
const vdFallbackStandingUrl = function(characterName, emotion){
  if (!vd_setting.fallback_deck_name) return '';
  const decks=findObjs({_type:'deck',name:vd_setting.fallback_deck_name});
  if (!decks.length) return '';
  let cardName=characterName;
  if (vd_setting.use_emotion && emotion && emotion !== '기본') cardName=characterName+'-'+emotion;
  const cards=findObjs({_type:'card',_deckid:decks[0].get('_id'),name:cardName});
  return cards.length ? cards[0].get('avatar') : '';
};
const vdExtraStandingUrl = function(speakerName){
  const deck=vdFindExtraDeck(); if (!deck) return '';
  let cards=findObjs({_type:'card',_deckid:deck.get('_id'),name:speakerName});
  if (!cards.length) cards=findObjs({_type:'card',_deckid:deck.get('_id')});
  return cards.length ? cards[0].get('avatar') : '';
};
const vdGetTextStyle = function(msg){
  const base=Object.assign({},vd_setting.text_styles.character_default);
  if (msg.type==='desc') return Object.assign(base,{dialogue_font_size:vd_setting.text_styles.desc.font_size,dialogue_font_color:vd_setting.text_styles.desc.font_color,dialogue_align:vd_setting.text_styles.desc.align});
  const ch=findCharacterWithName(msg.who);
  if (ch) return Object.assign(base,vd_setting.character_styles[msg.who]||{});
  if (playerIsGM(msg.playerid)) return Object.assign(base,vd_setting.text_styles.gm);
  return base;
};
const vdAlignLeft = function(bg,align,estimated){
  const center=Number(bg.get('left'))||0, width=Number(bg.get('width'))||0, textWidth=Math.min(width,Math.max(0,estimated||0));
  if (align==='right') return center+width/2-textWidth/2;
  if (align==='center') return center;
  return center-width/2+textWidth/2;
};
const vdSanitizeMessage = function(msg){
  let text=String(msg.content||'');
  if (Array.isArray(msg.inlinerolls)) text=text.replace(/\$\[\[(\d+)\]\]/g,(_,i)=>{const r=msg.inlinerolls[Number(i)];return r&&r.results&&r.results.total!=null?String(r.results.total):'';});
  text=text.replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g,'$1');
  text=text.replace(/style\s*=\s*"[^"]*"/gi,'').replace(/style\s*=\s*'[^']*'/gi,'');
  text=text.replace(/<br\s*\/?\s*>/gi,state.vd_divider).replace(/<[^>]+>/g,'');
  text=text.replace(/```|``|`/g,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1');
  text=text.replace(/&nbsp;|&#xA0;/gi,' ').replace(/\s{2,}/g,' ').trim();
  return {displayText:text,timingText:text.replace(new RegExp(state.vd_divider,'g'),' ').replace(/\s+/g,' ').trim()};
};
const vdArmWatchdog = function(){
  if (vdWatchdog) clearTimeout(vdWatchdog);
  vdWatchdog=setTimeout(function(){
    if (!vdProcessing) return;
    log('Roll20 Portrait Visual Dialogue: queue watchdog recovery');
    vdProcessing=false;
    if (state.vd_stock&&state.vd_stock.length) state.vd_stock.splice(0,1);
    if (state.vd_stock&&state.vd_stock.length) setTimeout(showDialogue,0);
  },Math.max(5000,Number(vd_setting.queue_watchdog_ms)||15000));
};
const vdReleaseProcessing = function(){ if (vdWatchdog) clearTimeout(vdWatchdog); vdWatchdog=null; vdProcessing=false; };




//on ready 
on('ready', function() {
    if (!Array.isArray(state.vd_stock)) state.vd_stock = [];
    vdProcessing = false;
});


//on chat 
on("chat:message", function(msg) {
	if ((msg.type == "general" || msg.type == "desc" || msg.type == "emote")
		&& (msg.playerid != 'API' || msg.content.includes(state.api_tag))
		&& !msg.rolltemplate){
		if (findCharacterWithName(msg.who) || findObjs({_type:'player',_displayname:msg.who.replace(' (GM)','')}).length == 0) {
			if (msg.content.length > 0) {
				msg.content = msg.content.replace(state.api_tag,'').replace(/<br>/g,state.vd_divider);
				msg.time = new Date().getTime();
				state.vd_stock.push(msg);
				if (!vdProcessing) { setTimeout(showDialogue,100); }
			} 
		}
	}


if (msg.type == "api"){
	if (msg.type == "api" && msg.content.indexOf("!@") === 0) {

		const current_page_id = vdGetCurrentPage();
		if (!current_page_id) {
			return;
		}

		if (msg.content == '!@숨김' || msg.content == '!@hide') {

			showHideDecorations('vd_deco',false);
			showHideDecorations('vd_panel',false);
			let bg_name = findObjs({ _type: 'graphic', name:'vd_name', _pageid:current_page_id});
			let bg_dialogue = findObjs({ _type: 'graphic', name:'vd_dialogue', _pageid:current_page_id});
			if (bg_name.length > 0) {
				bg_name = bg_name[0];
			} else {
				sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에 vd_name 토큰이 없습니다.",null,{noarchive:true});
				return;
			}
			if (bg_dialogue.length > 0) {
				bg_dialogue = bg_dialogue[0];
			} else {
				sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에 vd_dialogue 토큰이 없습니다.",null,{noarchive:true});
				return;
			}
			let text_name = getObj('text', bg_name.get('gmnotes'));
			let text_dialogue = getObj('text', bg_dialogue.get('gmnotes'));
			if (text_name) text_name.remove();
			if (text_dialogue) text_dialogue.remove();
			sendChat('vd-api-wildcard','!@퇴장:전원');

		} else if (msg.content.indexOf("!@퇴장") == 0 || msg.content.indexOf("!@exit") == 0) {

			const keyword = msg.content.replace("!@퇴장","").replace("!@exit","").replace(state.api_tag,'');

			if (keyword.length == 0) {
				removeStanding(msg);
			} else if (playerIsGM(msg.playerid) || msg.playerid == 'API' || msg.who == 'vd-api-wildcard') {
				if (keyword == ":전원" || keyword == ":전체" || keyword == ":all") {
					let tokens = findObjs({ _type: 'graphic', name: 'vd_standing', _pageid: current_page_id});
					tokens.forEach(token => {
						token.remove();
					});
				} else if (keyword == ":엑스트라" || keyword == ":extra") {
					let tokens = findObjs({ _type: 'graphic', name: 'vd_standing', represents: '', _pageid: current_page_id});
					tokens.forEach(token => {
						token.remove();
					});
				} else {
					msg.who = keyword.replace(":","");
					removeStanding(msg);
				}
			}

		} else if (playerIsGM(msg.playerid) && (msg.content == "!@리셋" || msg.content == "!@reset")) {
			
			state.vd_stock = [];
			sendChat("error","/w gm 표시 대기열에 쌓여있던 대사들을 초기화했습니다.",null,{noarchive:true});

		} else if (playerIsGM(msg.playerid) && (msg.content == "!@강제진행" || msg.content == "!@force-progress")) {
			
			showNextDialogue();

		} else if (playerIsGM(msg.playerid) && (msg.content.indexOf("!@배경 ") == 0 || msg.content.indexOf("!@background ") == 0)) {

			let bg_background = findObjs({ _type: 'graphic', name:'vd_background', _pageid:current_page_id});
			let bg_deck = findObjs({_type: 'deck', name:'background'});
			if (bg_background.length == 0) {
				sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에 vd_background 토큰이 없습니다.",null,{noarchive:true});
				return;
			}
			bg_background = bg_background[0];
			const current_url = bg_background.get('imgsrc');
			const new_bg = msg.content.replace('!@배경 ','').replace('!@background ','');
			let is_url_input = (msg.content.indexOf('https://') > -1);
			if (is_url_input) {
				bg_background.set('imgsrc',new_bg.replace('med','thumb').replace('max','thumb').replace(' ',''));
				if (current_url == bg_background.get('imgsrc')) {
					sendChat("error","/w gm 배경 이미지가 정상적으로 변경되지 않았습니다. 주소나 명령어 형식이 올바른지 확인해주세요. (ex: !@배경 https://이미지주소...)",null,{noarchive:true});
				}
			} else {
				if (bg_deck.length == 0) {
					sendChat("error","/w gm **background** 덱이 콜렉션에 없습니다. 사용할 배경 이미지를 background 덱에 넣거나 !@배경 https://이미지주소... 형식으로 이미지 주소를 직접 입력하세요.",null,{noarchive:true});
					return;
				} else {
					let bg_cards = findObjs({_type:'card', _deckid: bg_deck[0].get('_id'), name: new_bg});
					if (bg_cards.length == 0) {
						sendChat("error","/w gm 이름이 '**" + new_bg + "'**인 배경 카드가 **background** 덱에 없습니다.",
						null,{noarchive:true});
						return;
					} else {
						bg_background.set('imgsrc',bg_cards[0].get('avatar').replace('med','thumb').replace('max','thumb'));
					}
				}
			}

		} else {
            let cha_name=msg.who;
            let content_str=msg.content.replace(state.api_tag,'').replace('!@','');
            let emot=content_str;
            if (content_str.lastIndexOf(':')>-1 && (playerIsGM(msg.playerid)||msg.playerid=='API')) {
                cha_name=content_str.substring(0,content_str.lastIndexOf(':'));
                emot=content_str.substring(content_str.lastIndexOf(':')+1);
            }
            let chat_cha=findCharacterWithName(cha_name);
            let current_token=null;
            if (chat_cha||vd_setting.show_extra_standing) current_token=findTokenWithCharacter(chat_cha?chat_cha.get('_id'):'',cha_name);
            if (current_token) {
                let img=chat_cha ? (vdAlbumStandingUrl(chat_cha,emot)||vdFallbackStandingUrl(cha_name,emot)) : vdExtraStandingUrl(cha_name);
                if (!img) { sendChat('error','/w gm **'+cha_name+'**의 스탠딩 이미지를 찾지 못했습니다.',null,{noarchive:true}); return; }
                current_token.set({imgsrc:img.replace('med','thumb').replace('max','thumb'),bar1_value:cha_name,represents:chat_cha?chat_cha.get('_id'):'',width:vd_setting.width,height:vd_setting.height});
            }

		}    
	}
	


}
});


//on change card
on("change:card", function(obj, prev) {
	updateMacro(obj);
});


//on destroy card
on("destroy:card", function(obj) {
	updateMacro(obj);
});


//on destroy graphic
on("destroy:graphic", function(obj) {
    if (obj.get('name') == "vd_standing") {
        arrangeStandings(false);
    }
});


const vdGetCurrentPage = function() {
	const page_list = vd_setting.page_list.replace(/, /g,',').replace(/ ,/g,',').split(',');
	if (page_list.indexOf(getObj('page',Campaign().get("playerpageid")).get('name')) > -1) {
		return Campaign().get("playerpageid");
	} else {
		const page = findObjs({type:'page',name:page_list[0]});
		if (page.length > 0) {
			return page[0].get('_id');
		} else {
			sendChat("error","/w gm 이름이 **" + page_list[0] + "**인 페이지가 없습니다.",null,{noarchive:true});
		}
	}
}
const showDialogue = function() {
    if (vdProcessing) return;
    if (!Array.isArray(state.vd_stock) || !state.vd_stock.length) return;
    vdProcessing=true; vdArmWatchdog();
    let msg=state.vd_stock[0];
    try {
    for (let index = 1; index < state.vd_stock.length; index++) {
        const element = state.vd_stock[index];
        if (element.who == msg.who && Math.abs(element.time - msg.time) < 100) {
            msg.content = msg.content + state.vd_divider + element.content;
            state.vd_stock.splice(index,1);
            index--;
        } else {
            break;
        }
    }
	const current_page_id = vdGetCurrentPage();
	if (!current_page_id) {
		showNextDialogue();
		return;
	}
    let is_general = msg.type == "general";
    const textStyle = vdGetTextStyle(msg);
    const font_color = textStyle.dialogue_font_color;
    let font_size = textStyle.dialogue_font_size;
    let bg_area = findObjs({ _type: 'graphic', name:'vd_area', _pageid:current_page_id});
    let bg_name = findObjs({ _type: 'graphic', name:'vd_name', _pageid:current_page_id});
    let bg_dialogue = findObjs({ _type: 'graphic', name:'vd_dialogue', _pageid:current_page_id});
    let bg_panel = findObjs({ _type: 'graphic', name:'vd_panel', _pageid:current_page_id});
    let split = [];
    
    if (bg_area.length > 0) {
        bg_area = bg_area[0];
    } else {
        sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에 vd_area 토큰이 없습니다.",null,{noarchive:true});
        showNextDialogue();
        return;
    }
    if (bg_name.length > 0) {
        bg_name = bg_name[0];
    } else {
        sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에  vd_name 토큰이 없습니다.",null,{noarchive:true});
        showNextDialogue();
        return;
    }
    if (bg_dialogue.length > 0) {
        bg_dialogue = bg_dialogue[0];
    } else {
        sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에  vd_dialogue 토큰이 없습니다.",null,{noarchive:true});
        showNextDialogue();
        return;
    }
    if (bg_panel.length > 0) {
        bg_panel = bg_panel[0];
    } else {
        sendChat("error","/w gm **" + getObj('page',current_page_id).get('name') + "** 페이지에  vd_panel 토큰이 없습니다.",null,{noarchive:true});
        showNextDialogue();
        return;
    }
    const width = bg_dialogue.get('width');
    const name_width = bg_name.get('width');
    let blank_name = '';
    let blank_dialogue = '';
    let text_name = getObj('text', bg_name.get('gmnotes'));
    let text_dialogue = getObj('text', bg_dialogue.get('gmnotes'));
    while (name_width > blank_name.length*textStyle.name_font_size*vd_setting['letter_spacing']*1.2) { blank_name += " "; }
    while (width>blank_dialogue.length*font_size*vd_setting['letter_spacing']*1.15) { blank_dialogue += " "; }
    if (text_name && text_name.get('_pageid') != current_page_id) {
        text_name.remove();
        text_name = null;
    }
    if (text_dialogue && text_dialogue.get('_pageid') != current_page_id) {
        text_dialogue.remove();
        text_dialogue = null;
    } 
    if (!text_name) {
        text_name = createObj('text', {
            _pageid: bg_area.get('_pageid'),
            left: bg_name.get('left'),
            top: bg_name.get('top'),
            width: bg_name.get('width'),
            height: bg_name.get('height'),
            layer: 'objects',
            font_family: 'Arial',
            text: '',
            font_size: textStyle.name_font_size,
            color: textStyle.name_font_color
        });
        bg_name.set({'gmnotes':text_name.get('_id')});
    }
    if (!text_dialogue) {   
        text_dialogue = createObj('text', {
            _pageid: bg_dialogue.get('_pageid'),
            left: bg_dialogue.get('left'),
            top: bg_dialogue.get('top'),
            width: width,
            height: bg_dialogue.get('height'),
            layer: 'objects',
            font_family: 'Arial',
            text: '',
            font_size: font_size,
            color: font_color
        });
        bg_dialogue.set({'gmnotes':text_dialogue.get('_id')});
    }
    // 예외처리할 텍스트 제외
    let name = msg.who + '\n' + blank_name;
    const sanitized=vdSanitizeMessage(msg);
    let filtered=sanitized.displayText;
    let filter_word = [
        {regex:/\*.+\*/g,replace:/\*/g}, // *, **, ***
        {regex:/``.+``/g,replace:/``/g}, // ``
        {regex:/\[[^\(\)\[\]]*\]\(http[^\(\)\[\]]+\)/g,replace:/\[[^\(\)\[\]]*\]\(http[^\(\)\[\]]+\)/g}, // [](http...)
        {regex:/<[^>]*>/g,replace:/<[^>]*>/g}, // <html>
		{regex:/\(.{1}\" style=\"[^\)]+\)/g,replace:/\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/g}, // [](#" style="...)
        {regex:/(?!x)x/g,replace:/(?!x)x/g}]; // 인라인롤은 위에서 최종 숫자로 치환
    for (let i=0;i<filter_word.length;i++) {
        let match = filtered.match(filter_word[i].regex);
        if (match) {
            for (let j=0;j<match.length;j++) {
                filtered = filtered.replace(match[j], match[j].replace(filter_word[i].replace,''));
            }
        }
    }
    let ruby_match = filtered.match(/\([^\(\)\[\]]+\)\[[^\(\)\[\]]*\]/g);
    if (ruby_match) {
        for (let j=0;j<ruby_match.length;j++) {
            let rubystr_split = ruby_match[j].substring(1,ruby_match[j].length-1).split(')[');
            filtered = filtered.replace(ruby_match[j], rubystr_split[1]+"("+rubystr_split[0]+")");
        }
    }
    if (filtered.length == 0){
        showNextDialogue();
        return;
    }
	let str = filtered;
    let desc_ratio = is_general ? 1 : 0.8;
    let amount = Math.ceil(width/font_size/vd_setting['letter_spacing']*3) -3;
    let idx = 0;
    let length = 0;
    const thirdchar = ['\'',' ',',','.','!',':',';','"'];
    const halfchar = ['[',']','(',')','*','^','-','~','<','>','+','l','i','1'];
    const arr = thirdchar.concat(halfchar);
    let divided = false;
    for (let i=0;i<str.length;i++){
        let c = str[i];
        length += 3;
        for (let j=0;j<arr.length;j++) {
            if (c==arr[j]) {
                length -= (j<thirdchar.length ? 2 : 1);
                break;
            }
        }
        if (length >= amount * desc_ratio || c == state.vd_divider) {
            let substr = str.substring(idx,i+1).replace(state.vd_divider,'');
            split.push(is_general || msg.who.length > 0 ? substr:getStringWithMargin(amount,length,desc_ratio,substr));
            idx = i+1;
            length = 0;
            if ((split.length+1) * font_size * vd_setting['letter_spacing']*3 > bg_dialogue.get('height')) {
                state.vd_stock.splice(1,0,{content:filtered.substring(idx,str.length),time:msg.time,playerid:msg.playerid,type:msg.type,who:msg.who});
                divided = true;
                break;
            }
        }
    }
    if (idx < str.length && !divided) {
        let substr = str.substring(idx,str.length);
        split.push(is_general || msg.who.length > 0 ? substr:getStringWithMargin(amount,length,desc_ratio,substr));
    } 
    if (is_general || msg.who.length > 0) {
        while ((split.length+1) * font_size * vd_setting['line_height'] < bg_dialogue.get('height')) {
            split.push(' ');
        }
    } else {
        split.splice(0,0,' ');
    }
    split.push(blank_dialogue);
    const estimatedNameWidth=Math.min(bg_name.get('width'),Math.max(1,String(msg.who||'').length)*textStyle.name_font_size*vd_setting.letter_spacing);
    const nameLeft=vdAlignLeft(bg_name,textStyle.name_align,estimatedNameWidth);
    const dialogueBg=msg.type=='desc'?bg_panel:bg_dialogue;
    const longestLine=split.reduce((mx,line)=>Math.max(mx,String(line).length),0);
    const estimatedDialogueWidth=Math.min(dialogueBg.get('width'),Math.max(1,longestLine)*font_size*vd_setting.letter_spacing);
    const dialogueLeft=vdAlignLeft(dialogueBg,textStyle.dialogue_align,estimatedDialogueWidth);
    text_name.set({text:name,left:nameLeft,font_size:textStyle.name_font_size,color:textStyle.name_font_color,top:bg_name.get('top')+textStyle.name_font_size*vd_setting.line_height/2});
    text_dialogue.set({text:split.join('\n'),font_size:font_size,color:font_color,left:dialogueLeft,top:msg.type=='desc'?bg_panel.get('top'):bg_dialogue.get('top')});
    toFront(text_name);
    toFront(text_dialogue);
    setTimeout(() => {
		showHideDecorations('vd_panel',true);
		showHideDecorations('vd_deco',msg.type != 'desc');
        toFront(text_name);
        toFront(text_dialogue);
    }, 100);
	clearTextWithout(text_name, text_dialogue);
    const ignore_list = vd_setting.ignore_list.replace(/, /g,',').replace(/ ,/g,',').split(',');
    if (msg.type != "desc" && ignore_list.indexOf(msg.who) < 0) {
        let chat_cha = findCharacterWithName(msg.who);
        let current_token = null;
        if (chat_cha || vd_setting.show_extra_standing) {
            current_token = findTokenWithCharacter(chat_cha?chat_cha.get('_id'):'', msg.who);
        }
        let tokens = findObjs({ _type: 'graphic', name: 'vd_standing', _pageid: current_page_id});
        let lowest_priority = tokens[0];
        for (var i=0;i<tokens.length;i++) {
            var token = tokens[i];
            token.set('tint_color','#000000');
            if (parseInt(token.get('gmnotes')) < parseInt(lowest_priority.get('gmnotes'))) {
                lowest_priority = token;
            }
        }
        if (current_token == null && (chat_cha || vd_setting.show_extra_standing)) {
            let standingUrl = chat_cha ? (vdAlbumStandingUrl(chat_cha,'') || vdFallbackStandingUrl(msg.who,'')) : vdExtraStandingUrl(msg.who);
            if (!standingUrl) { sendChat('error','/w gm **'+msg.who+'**의 스탠딩 이미지를 찾지 못했습니다.',null,{noarchive:true}); showNextDialogue(); return; }
            let opt={name:'vd_standing',_pageid:bg_area.get('_pageid'),width:vd_setting.width,height:vd_setting.height,bar1_value:msg.who,layer:'gmlayer',imgsrc:standingUrl.replace('med','thumb').replace('max','thumb'),represents:chat_cha?chat_cha.get('_id'):''};
            if (tokens.length >= vd_setting.max_number) opt.left=lowest_priority.get('left'); else opt.left=arrangeStandings(true);
            opt.top=bg_area.get('top');
            if (tokens.length >= vd_setting.max_number) { lowest_priority.set(opt); current_token=lowest_priority; } else current_token=createObj('graphic',opt);
            if (current_token) { toFront(current_token); setTimeout(()=>{ try { current_token.set({tint_color:'transparent',gmnotes:Date.now(),layer:'map'}); } catch(e){ log('standing update error: '+e.message); } },100); }
        } else if (current_token) {
            toFront(current_token);
            current_token.set({tint_color:'transparent',gmnotes:Date.now()});
        }
    }
	state.last_displayed_time = new Date().getTime();
    const timingLength=(sanitized&&sanitized.timingText?sanitized.timingText.length:str.length);
    setTimeout(showNextDialogue,Math.max(vd_setting.min_showtime,timingLength*vd_setting.showtime_ratio));
    } catch(error) {
      log('Roll20 Portrait Visual Dialogue error: '+(error&&error.stack?error.stack:error));
      sendChat('error','/w gm Portrait Visual Dialogue 오류로 해당 대사를 건너뜁니다.',null,{noarchive:true});
      setTimeout(showNextDialogue,0);
    }
}
const clearTextWithout = function(name_txt, dial_txt) {
    if (!name_txt || !dial_txt) return;
	let filtered_txt = filterObjs(function(obj) {
		return (obj.get('_type') == 'text' && obj.get("_pageid") == name_txt.get('_pageid')
		&& obj.get("_id") != name_txt.get('_id') && obj.get("_id") != dial_txt.get('_id')
		&& ((Math.abs(obj.get("left") - name_txt.get('left')) < 100 && Math.abs(obj.get("top") - name_txt.get('top')) < 100) ||
		(Math.abs(obj.get("left") - dial_txt.get('left')) < 100 && Math.abs(obj.get("top") - dial_txt.get('top')) < 100)));
	});
	filtered_txt.forEach(txt => {
		txt.remove();
	});
}
const updateMacro = function(obj) {
	let background_deck = findObjs({type:'deck',name:'background'});
	if (background_deck.length > 0 && obj.get('deckid') == background_deck[0].get('id')) {
		if (background_deck.length > 1) {
			sendChat("error","/w gm **background** 덱이 **" + background_deck.length + "**개 있습니다. 먼저 생성된 1개 덱을 기준으로 매크로를 생성합니다.",null,{noarchive:true});
		}
		let players = findObjs({type:'player'});
		let bg_images = findObjs({_type:'card',_deckid:background_deck[0].get('id')});
		let bg_macro = findObjs({_type:'macro',name:"배경전환"});
		let action_str = "!@배경 ?{배경을 선택하세요";
		let gm_list = "";
		for (let index = 0; index < bg_images.length; index++) {
			const card = bg_images[index];
			action_str += "|" + card.get('name');
		}
		for (let index = 0; index < players.length; index++) {
			const player = players[index];
			if (playerIsGM(player.id)) {
				gm_list += player.id + ",";
			}
		}
		gm_list = gm_list.substring(0,gm_list.length - 1);
		action_str += "}";
		let options = {name:"배경전환",action:action_str,visibleto:gm_list};
		if (bg_macro.length > 0) {
			bg_macro = bg_macro[0];
			bg_macro.set(options);
		} else {
			options.playerid = players[0].get('id');
			bg_macro = createObj('macro',options);
		}
	}
}
const showHideDecorations = function(name, show) {
    const text_deco = findObjs({name: name, _type: 'graphic'});
    for (let index = 0; index < text_deco.length; index++) {
        const itm = text_deco[index];
        if (show) {
            if (itm.get('gmnotes').includes('/')) {
                const wh = itm.get('gmnotes').split('/');
                itm.set({width:parseInt(wh[0]),height:parseInt(wh[1]),layer:'objects'});
            }
			toFront(itm);
        } else {
            if (itm.get('gmnotes').length == 0) {
                itm.set({gmnotes:itm.get('width')+"/"+itm.get('height')});
            }
            itm.set({width:1,height:1,layer:'gmlayer'});
        }
    }
}
const showNextDialogue = function() {
    vdReleaseProcessing();
    if (!Array.isArray(state.vd_stock)) state.vd_stock=[];
    if (state.vd_stock.length>0) state.vd_stock.splice(0,1);
    if (state.vd_stock.length>0) setTimeout(showDialogue,0);
}
const getStringWithMargin = function(amount, length, ratio, str) {
    let margin = Math.round((amount - length)/4*ratio);
    for (var j=0;j<margin;j++){
        str = "ㅤ" + str + "ㅤ"; 
    }
    return str;
}  
const findCharacterWithName = function(who) {
    let chat_cha = findObjs({ _type: 'character', name: who});
    if (chat_cha.length > 0) {
        return chat_cha[0];
    } else {
        return null;
    }
}
const findTokenWithCharacter = function(id, who) {
    let arr = findObjs({ _type: 'graphic', name: 'vd_standing', represents: id, _pageid: vdGetCurrentPage(), bar1_value: who});
    if (arr.length > 0) {
        return arr[0];
    }
    return null;
}
const removeStanding = function(msg) {
    let character = findCharacterWithName(msg.who);
    let token = findTokenWithCharacter(character?character.get('_id'):'', msg.who);
    if (token) {
        token.remove();
        arrangeStandings(false);
    }
}
const arrangeStandings = function(addNew) {
	const currernt_page_id = vdGetCurrentPage();
    let tokens = findObjs({ _type: 'graphic', name: 'vd_standing', _pageid: currernt_page_id});
    if (tokens.length > 0 || addNew) {
        let bg_area = findObjs({ _type: 'graphic', name:'vd_area', _pageid:currernt_page_id});
        if (bg_area.length > 0) {
            bg_area = bg_area[0];
        } else {
            sendChat("error1","/w gm vd_area 토큰이 없습니다.",null,{noarchive:true});
            return;
        }
        let tokens_position = [];
        const compare = function( a, b ) {
            if ( a.left < b.left ){
              return -1;
            }
            if ( a.left > b.left ){
              return 1;
            }
            return 0;
          }
        for (var i=0;i<tokens.length;i++) {
            tokens_position.push({idx:i,left:tokens[i].get('left')});
        }
        tokens_position.sort(compare);
        let final_count = tokens.length + (addNew?1:0);
        final_count = final_count<2? 2: final_count;
        let space = Math.floor(bg_area.get('width')/final_count);
        let left = bg_area.get('left') - Math.floor(bg_area.get('width')/2);
        if (space < vd_setting.fit_width) {
            left += vd_setting.fit_width/2;
            space = Math.floor((bg_area.get('width')-vd_setting.fit_width)/(final_count-1));
        } else {
            left += space/2
        }
        let rand = addNew ? Math.floor(Math.random()*(tokens_position.length-1))+1 : Infinity;
        rand = rand < 0 ? 0 : rand;
        for (var i=0;i<tokens_position.length;i++) {
            let token = tokens[tokens_position[i].idx];
            token.set('left',left + space * (i + (i>=rand?1:0)));
        }
        return addNew ? left + space * (rand == Infinity ? 0 : rand) : false;
    }
}


