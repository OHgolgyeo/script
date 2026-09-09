// ==UserScript==
// @name         Roll20 Video Player
// @namespace    https://github.com/OHgolgyeo/script
// @version      1.0
// @author       오골계 (https://x.com/5golgyeo)
// @description  롤20 채팅의 신호(CUE|url|시각|모드)를 감지해서, 영상을 소리와 함께 재생합니다. 재생이 가능한 영상은 mp4 등 직링크와 X(Twitter), 구글 드라이브, 유튜브 링크입니다. full(전체화면)/map(맵 화면에 꽉차게)/window(작은 창, 드래그로 위치 이동 가능) 세 가지 모드를 지원하고, 짝을 이루는 "Roll20 Video Player.js" 롤20 API 스크립트가 GM 쪽에 설치되어 있어야 신호가 옵니다.
// @match        https://app.roll20.net/editor/*
// @grant        GM_xmlhttpRequest
// @connect      cdn.syndication.twimg.com
// @connect      video.twimg.com
// @updateURL    https://raw.githubusercontent.com/OHgolgyeo/script/main/tampermonkey-scripts/Roll20%20Video%20Player.user.js
// @downloadURL  https://raw.githubusercontent.com/OHgolgyeo/script/main/tampermonkey-scripts/Roll20%20Video%20Player.user.js
// ==/UserScript==

(function () {
  'use strict';


  var CUE_PATTERN = /CUE\|(\S+)\|(\d+)\|(full|map|window)/;
  var WINDOW_HANDLE_HEIGHT = 22; // 창 모드 드래그 손잡이 높이(px)

  // 유튜브 링크(watch?v=, youtu.be/, /embed/ 등)에서 영상 ID만 뽑아냄.
  // 매치 안 되면 null → 일반 mp4 등 직링크로 처리됨.
  function extractYouTubeId(url) {
    var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
    return m ? m[1] : null;
  }

  // X(Twitter) 게시물/영상 링크에서 status ID를 뽑아냄.
  // 예: https://x.com/user/status/123456789/video/1
  function extractTwitterStatusId(url) {
    var m = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
    return m ? m[1] : null;
  }

  // X의 공개 임베드용 syndication endpoint가 요구하는 token 계산.
  function getTwitterSyndicationToken(id) {
    var n = (Number(id) / 1e15) * Math.PI;
    return n.toString(36).replace(/(0+|\.)/g, '');
  }

  // X 영상 variants 중 MP4만 추려 가장 높은 bitrate를 선택.
  function pickBestTwitterMp4(variants) {
    var mp4s = (variants || []).filter(function (v) {
      return v && v.content_type === 'video/mp4' && v.url;
    });

    if (!mp4s.length) return null;

    mp4s.sort(function (a, b) {
      return (b.bitrate || 0) - (a.bitrate || 0);
    });

    return mp4s[0].url;
  }

  // X 게시물 URL → 실제 video.twimg.com MP4 주소로 변환.
  function resolveTwitterVideoUrl(tweetUrl) {
    var tweetId = extractTwitterStatusId(tweetUrl);
    if (!tweetId) return Promise.resolve(null);

    var apiUrl = 'https://cdn.syndication.twimg.com/tweet-result' +
      '?id=' + encodeURIComponent(tweetId) +
      '&token=' + encodeURIComponent(getTwitterSyndicationToken(tweetId)) +
      '&lang=ko';

    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: apiUrl,
        onload: function (response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('X 영상 정보를 가져오지 못했습니다.'));
            return;
          }

          var tweet;
          try {
            tweet = JSON.parse(response.responseText);
          } catch (e) {
            reject(new Error('X 영상 정보 응답을 해석하지 못했습니다.'));
            return;
          }

          var mediaDetails = tweet && (
            tweet.mediaDetails ||
            (tweet.extended_entities && tweet.extended_entities.media)
          );

          var bestUrl = null;
          (mediaDetails || []).some(function (media) {
            if (!media || (media.type !== 'video' && media.type !== 'animated_gif')) return false;
            bestUrl = pickBestTwitterMp4(media.video_info && media.video_info.variants);
            return !!bestUrl;
          });

          if (!bestUrl) {
            reject(new Error('이 X 게시물에서 재생 가능한 MP4 영상을 찾지 못했습니다.'));
            return;
          }

          resolve(bestUrl);
        },
        onerror: function () {
          reject(new Error('X 영상 정보 요청에 실패했습니다.'));
        }
      });
    });
  }

  function findChatLog() {
    // 롤20 채팅 패널의 실제 DOM 구조는 버전에 따라 바뀔 수 있어서,
    // 흔히 쓰이는 후보들을 순서대로 시도함. 안 맞으면 실제 DOM 보고 조정 필요.
    return document.querySelector('#textchat .content')
      || document.querySelector('#textchat')
      || document.querySelector('.chat-content')
      || document.body;
  }

  function showAudioUnlockPrompt(video, overlay) {
    var prompt = document.createElement('div');
    prompt.style.cssText = [
      'position:absolute', 'inset:0', 'display:flex',
      'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)', 'cursor:pointer',
      'z-index:2'
    ].join(';');

    var btn = document.createElement('div');
    btn.textContent = '🔊 클릭해서 재생';
    btn.style.cssText = [
      'font-family:sans-serif', 'font-size:22px', 'color:#fff',
      'background:rgba(255,255,255,0.15)', 'padding:16px 28px',
      'border-radius:12px', 'border:1px solid rgba(255,255,255,0.4)'
    ].join(';');

    prompt.appendChild(btn);
    overlay.appendChild(prompt);

    prompt.addEventListener('click', function () {
      video.play().catch(function (e) {
      });
      prompt.remove();
    });
  }

  // 롤20 새 태블탑은 지도가 <canvas id="babylonCanvas">로 그려지고,
  // 채팅창 너비에 따라 이 캔버스의 실제 크기/위치가 바뀜. map 모드일 땐
  // 이 요소의 실제 화면상 위치(getBoundingClientRect)를 기준으로 그 영역을
  // 꽉 채워서 재생함(채팅창은 안 가림). window 모드는 이 영역 중앙을 초기
  // 위치로만 씀(이후 드래그로 자유롭게 옮길 수 있음). 못 찾으면 화면
  // 전체를 기준으로 함.
  function getMapRect() {
    var canvas = document.getElementById('babylonCanvas');
    if (canvas) return canvas.getBoundingClientRect();
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function playCutscene(url, mode) {
    var isMap = mode === 'map';
    var isWindow = mode === 'window';
    var isFloating = isMap || isWindow; // 전체화면이 아닌 두 모드(작은 UI 크기를 공유)

    var overlay = document.createElement('div');
    overlay.id = 'cutscene-overlay';
    if (isWindow) {
      // 크기/위치는 아래 initWindowLayout()에서 잡고, 이후 드래그로 옮길 수 있음
      overlay.style.cssText = [
        'position:fixed', 'display:flex', 'flex-direction:column',
        'background:#000', 'z-index:999999',
        'border-radius:8px', 'overflow:hidden',
        'box-shadow:0 6px 24px rgba(0,0,0,0.5)'
      ].join(';');
    } else if (isMap) {
      // 위치/크기는 아래 updateMapLayout()에서 지도 영역 기준으로 딱 맞춰서 잡음
      overlay.style.cssText = [
        'position:fixed', 'background:#000',
        'z-index:999999', 'display:flex',
        'align-items:center', 'justify-content:center',
        'overflow:hidden'
      ].join(';');
    } else {
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:#000',
        'z-index:999999', 'display:flex',
        'align-items:center', 'justify-content:center'
      ].join(';');
    }

    var closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = [
      'position:absolute', 'top:' + (isFloating ? '2px' : '16px'),
      'right:' + (isFloating ? '6px' : '20px'),
      'font-family:sans-serif', 'font-size:' + (isFloating ? '15px' : '26px'),
      'color:#fff', 'cursor:pointer', 'z-index:3',
      'opacity:0', 'transition:opacity .15s ease' // 평소엔 숨김, 마우스 올리면 나타남
    ].join(';');
    closeBtn.addEventListener('click', function () {
      closeOverlay();
    });
    overlay.addEventListener('mouseenter', function () {
      closeBtn.style.opacity = '0.85';
    });
    overlay.addEventListener('mouseleave', function () {
      closeBtn.style.opacity = '0';
    });
    overlay.appendChild(closeBtn);

    // window 모드 전용: 위쪽 드래그 손잡이 (마우스로 눌러서 창 위치 이동)
    var dragHandle = null;
    if (isWindow) {
      dragHandle = document.createElement('div');
      dragHandle.style.cssText = [
        'width:100%', 'height:' + WINDOW_HANDLE_HEIGHT + 'px', 'flex-shrink:0',
        'background:rgba(255,255,255,0.12)', 'cursor:move'
      ].join(';');
      overlay.appendChild(dragHandle);
    }

    var youTubeId = extractYouTubeId(url);
    var media; // video 요소 또는 iframe 요소 — 아래에서 분기해서 만듦
    var resizeObserver = null;
    var onDragMove = null;
    var onDragEnd = null;

    // map 모드일 때, 지도 캔버스 영역(getMapRect)에 오버레이 자체를 정확히
    // 겹쳐서(같은 left/top/width/height) 빈틈없이 채움. 채팅창 너비가 바뀌어
    // 캔버스 크기가 변할 때마다(ResizeObserver) 다시 호출돼서 계속 따라감.
    function updateMapLayout() {
      if (!isMap) return;
      var rect = getMapRect();
      overlay.style.setProperty('left', rect.left + 'px', 'important');
      overlay.style.setProperty('top', rect.top + 'px', 'important');
      overlay.style.setProperty('width', rect.width + 'px', 'important');
      overlay.style.setProperty('height', rect.height + 'px', 'important');

      media.style.setProperty('width', '100%', 'important');
      media.style.setProperty('height', '100%', 'important');
    }

    // window 모드일 때, 영상 원본 비율(또는 유튜브면 16:9 기본값)에 맞춰
    // 적당한 크기를 정하고, 지도 영역(또는 화면) 중앙을 초기 위치로 잡음.
    // 이후엔 드래그로 자유롭게 옮길 수 있음(이 함수는 처음 한 번만 실행됨).
    function initWindowLayout() {
      if (!isWindow) return;
      var rect = getMapRect();
      var boxW, boxH;

      if (media.tagName === 'VIDEO' && media.videoWidth) {
        var scale = Math.min((rect.width * 0.5) / media.videoWidth, (rect.height * 0.6) / media.videoHeight);
        boxW = Math.round(media.videoWidth * scale);
        boxH = Math.round(media.videoHeight * scale);
      } else {
        boxW = Math.round(Math.min(480, rect.width * 0.5));
        boxH = Math.round(boxW * 9 / 16);
      }

      media.style.setProperty('width', boxW + 'px', 'important');
      media.style.setProperty('height', boxH + 'px', 'important');
      overlay.style.setProperty('width', boxW + 'px', 'important');
      overlay.style.setProperty('height', (boxH + WINDOW_HANDLE_HEIGHT) + 'px', 'important');
      overlay.style.setProperty('left', Math.round(rect.left + rect.width / 2 - boxW / 2) + 'px', 'important');
      overlay.style.setProperty('top', Math.round(rect.top + rect.height / 2 - boxH / 2) + 'px', 'important');
    }

    function closeOverlay() {
      if (media && media.tagName === 'VIDEO') media.pause();
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateMapLayout);
      if (onDragMove) document.removeEventListener('mousemove', onDragMove);
      if (onDragEnd) document.removeEventListener('mouseup', onDragEnd);
      overlay.remove();
    }

    if (youTubeId) {
      // 유튜브는 직링크가 없어서 <video>로 못 돌림 → 공식 embed iframe으로 재생.
      // 롤20이 iframe을 막는 건 "롤20 서버에 저장되는 콘텐츠"에만 해당되고,
      // 템퍼몽키는 브라우저에서 직접 DOM을 만드는 거라 그 제약과 무관함.
      media = document.createElement('iframe');
      media.src = 'https://www.youtube.com/embed/' + youTubeId +
        '?autoplay=1&mute=0&rel=0&playsinline=1';
      media.allow = 'autoplay; encrypted-media';
      media.setAttribute('frameborder', '0');
      overlay.appendChild(media);

      if (!isFloating) {
        media.style.setProperty('width', '100%', 'important');
        media.style.setProperty('height', '100%', 'important');
      }
      media.style.setProperty('border', 'none', 'important');

      // 유튜브는 iframe 안이 다른 도메인이라 재생 성공/종료 여부를 감지할
      // 방법이 없음 — 자동재생 실패 시 안내나 재생 종료 시 자동 닫기는
      // 지원 안 되고, 닫기 버튼(✕)이나 ESC로 직접 닫아야 함
      if (isWindow) initWindowLayout(); // 원본 해상도를 못 읽으니 바로 기본 크기로 잡음
    } else {
      media = document.createElement('video');
      media.src = url;
      media.autoplay = true;
      media.muted = false;
      media.controls = isFloating; // map/window 모드일 땐 직접 조작할 수 있게 컨트롤 표시
      overlay.appendChild(media);

      // 롤20 페이지 자체의 CSS가 video 태그에 !important로 크기를 강제하고
      // 있을 수 있어서, setProperty로 우선순위를 맞춰 확실하게 덮어씀.
      // contain: 자르지 않고 비율 유지한 채 축소, 남는 공간엔 검은 배경이
      // 깔림(영화관 레터박스 느낌) — 세 모드 다 동일하게 적용
      media.style.setProperty('object-fit', 'contain', 'important');
      if (!isFloating) {
        media.style.setProperty('width', '100%', 'important');
        media.style.setProperty('height', '100%', 'important');
      }
      if (isWindow) {
        media.addEventListener('loadedmetadata', initWindowLayout); // 원본 해상도 알아야 크기 계산 가능
      }

      media.addEventListener('ended', closeOverlay);
    }

    if (isMap) {
      updateMapLayout();
      var mapCanvas = document.getElementById('babylonCanvas');
      if (mapCanvas && window.ResizeObserver) {
        resizeObserver = new ResizeObserver(updateMapLayout);
        resizeObserver.observe(mapCanvas);
      }
      window.addEventListener('resize', updateMapLayout);
    }

    if (isWindow && dragHandle) {
      var dragOffsetX = 0, dragOffsetY = 0, isDragging = false;

      dragHandle.addEventListener('mousedown', function (e) {
        isDragging = true;
        var r = overlay.getBoundingClientRect();
        dragOffsetX = e.clientX - r.left;
        dragOffsetY = e.clientY - r.top;
        e.preventDefault();
      });

      onDragMove = function (e) {
        if (!isDragging) return;
        overlay.style.setProperty('left', (e.clientX - dragOffsetX) + 'px', 'important');
        overlay.style.setProperty('top', (e.clientY - dragOffsetY) + 'px', 'important');
      };
      onDragEnd = function () { isDragging = false; };

      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    }

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeOverlay();
        document.removeEventListener('keydown', escHandler);
      }
    });

    document.body.appendChild(overlay);

    if (media.tagName === 'VIDEO') {
      var playPromise = media.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {
          // 브라우저의 소리 있는 자동재생 차단에 걸린 경우 → 클릭 유도
          showAudioUnlockPrompt(media, overlay);
        });
      }
    }
  }

  var CUE_STALE_THRESHOLD_MS = 10000; // 이보다 더 지난 신호는 무시 (새로고침 시 예전 기록 재생 방지)
  var processedCues = {}; // 이미 처리한 신호(주소+시각+모드) 기록 — 같은 신호가 중복 감지돼도 한 번만 재생

  function handleCueText(text, cueElement) {
    var m = text.match(CUE_PATTERN);
    if (!m) return;

    var cueKey = m[0]; // "CUE|주소|시각|모드" 전체를 그대로 키로 사용
    if (processedCues[cueKey]) return; // 이미 처리한 신호 → 중복 감지 무시
    processedCues[cueKey] = true;

    var url = m[1];
    var startAt = parseInt(m[2], 10);
    var mode = m[3];

    // 신호 메시지 자체는 플레이어 화면에서 바로 숨김
    if (cueElement) cueElement.style.display = 'none';

    var delay = startAt - Date.now();

    if (delay < -CUE_STALE_THRESHOLD_MS) {
      // 너무 오래 지난 신호 → 새로고침으로 다시 로드된 예전 채팅 기록일 가능성이 큼. 무시.
      return;
    }

    function schedulePlayback(resolvedUrl) {
      var remaining = startAt - Date.now();
      if (remaining <= 0) {
        playCutscene(resolvedUrl, mode);
      } else {
        setTimeout(function () { playCutscene(resolvedUrl, mode); }, remaining);
      }
    }

    // X 게시물 링크면 신호를 받은 즉시 실제 MP4 주소를 먼저 추출한다.
    // 추출에 시간이 걸려도 원래 지정 시각을 기준으로 남은 시간만 기다리고,
    // 이미 지정 시각이 지났다면 추출 완료 즉시 재생한다.
    if (extractTwitterStatusId(url)) {
      resolveTwitterVideoUrl(url).then(function (resolvedUrl) {
        schedulePlayback(resolvedUrl);
      }).catch(function () {
        // 익명 syndication 조회가 막히거나 MP4가 없으면 해당 컷신은 재생하지 않음.
      });
      return;
    }

    schedulePlayback(url);
  }

  function init() {
    var chatLog = findChatLog();
    if (!chatLog) {
      setTimeout(init, 1000);
      return;
    }

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          var text = node.textContent || '';
          if (CUE_PATTERN.test(text)) {
            handleCueText(text, node);
          }
        });
      });
    });

    observer.observe(chatLog, { childList: true, subtree: true });
  }

  function startWhenReady() {
    setTimeout(init, 2000); // 롤20 채팅창이 완전히 로드될 시간을 좀 줌
  }

  if (document.readyState === 'complete') {
    // load 이벤트가 스크립트 주입 시점보다 이미 지나갔을 수 있음 → 바로 시작
    startWhenReady();
  } else {
    window.addEventListener('load', startWhenReady);
  }
})();
