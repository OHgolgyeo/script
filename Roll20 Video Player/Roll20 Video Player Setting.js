// ==UserScript==
// @name         Roll20 Video Player
// @namespace    https://github.com/OHgolgyeo/script
// @version      1.0
// @author       오골계 (https://x.com/5golgyeo)
// @description  롤20 채팅의 신호(CUE|url|시각|모드)를 감지해서, 영상을 소리와 함께 재생합니다. 재생이 가능한 영상은 mp4 등 직링크와 X(Twitter), 구글 드라이브, 유튜브 링크입니다. full(전체화면)/map(맵 화면에 꽉차게)/window(작은 창, 드래그·크기조절 가능) 세 가지 모드를 지원하고, 짝을 이루는 "Roll20 Video Player.js" 롤20 API 스크립트가 GM 쪽에 설치되어 있어야 신호가 옵니다.
// @match        https://app.roll20.net/editor/*
// @grant        GM_xmlhttpRequest
// @connect      cdn.syndication.twimg.com
// @connect      video.twimg.com
// @updateURL    https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Video%20Player/Roll20%20Video%20Player%20Setting.js
// @downloadURL  https://raw.githubusercontent.com/OHgolgyeo/script/refs/heads/main/Roll20%20Video%20Player/Roll20%20Video%20Player%20Setting.js
// ==/UserScript==

(function () {
  'use strict';

  var CUE_PATTERN = /CUE\|(\S+)\|(\d+)\|(full|map|window)/;
  var WINDOW_HANDLE_HEIGHT = 22;

  function extractYouTubeId(url) {
    var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
    return m ? m[1] : null;
  }

  function extractGoogleDriveId(url) {
    var m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=|uc\?export=download&id=)([a-zA-Z0-9_-]{10,})/);
    return m ? m[1] : null;
  }

  function extractTwitterStatusId(url) {
    var m = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
    return m ? m[1] : null;
  }

  function getTwitterSyndicationToken(id) {
    var n = (Number(id) / 1e15) * Math.PI;
    return n.toString(36).replace(/(0+|\.)/g, '');
  }

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

  // 트위터 CDN은 <video src>로 직접 요청하면 403을 돌려줌.
  // GM_xmlhttpRequest로 커스텀 헤더를 붙여 받아온 뒤 blob URL로 변환해서 우회.
  function fetchAsBlobUrl(fileUrl) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: fileUrl,
        responseType: 'blob',
        headers: {
          'Referer': 'https://x.com/',
          'Origin': 'https://x.com'
        },
        onload: function (response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('X 영상 파일을 가져오지 못했습니다 (status ' + response.status + ').'));
            return;
          }
          resolve(URL.createObjectURL(response.response));
        },
        onerror: function () {
          reject(new Error('X 영상 파일 요청에 실패했습니다.'));
        }
      });
    });
  }

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

          fetchAsBlobUrl(bestUrl).then(resolve, reject);
        },
        onerror: function () {
          reject(new Error('X 영상 정보 요청에 실패했습니다.'));
        }
      });
    });
  }

  function findChatLog() {
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
      video.play().catch(function () {});
      prompt.remove();
    });
  }

  function getMapRect() {
    var canvas = document.getElementById('babylonCanvas');
    if (canvas) return canvas.getBoundingClientRect();
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function playCutscene(url, mode) {
    var isMap = mode === 'map';
    var isWindow = mode === 'window';
    var isFloating = isMap || isWindow;

    var overlay = document.createElement('div');
    overlay.id = 'cutscene-overlay';
    if (isWindow) {
      overlay.style.cssText = [
        'position:fixed', 'display:flex', 'flex-direction:column',
        'background:#000', 'z-index:999999',
        'border-radius:8px', 'overflow:hidden',
        'box-shadow:0 6px 24px rgba(0,0,0,0.5)'
      ].join(';');
    } else if (isMap) {
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
      'opacity:0', 'transition:opacity .15s ease'
    ].join(';');
    closeBtn.addEventListener('click', function () {
      closeOverlay();
    });

    var resizeHandle = null;
    if (isWindow) {
      resizeHandle = document.createElement('div');
      resizeHandle.style.cssText = [
        'position:absolute', 'right:0', 'bottom:0', 'width:16px', 'height:16px',
        'cursor:nwse-resize', 'z-index:3', 'opacity:0', 'transition:opacity .15s ease',
        'background:linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%)'
      ].join(';');
    }

    overlay.addEventListener('mouseenter', function () {
      closeBtn.style.opacity = '0.85';
      if (resizeHandle) resizeHandle.style.opacity = '0.85';
    });
    overlay.addEventListener('mouseleave', function () {
      closeBtn.style.opacity = '0';
      if (resizeHandle) resizeHandle.style.opacity = '0';
    });
    overlay.appendChild(closeBtn);
    if (resizeHandle) overlay.appendChild(resizeHandle);

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
    var driveId = extractGoogleDriveId(url);
    var media;
    var resizeObserver = null;
    var onDragMove = null;
    var onDragEnd = null;
    var onWindowResizeMove = null;
    var onWindowResizeEnd = null;

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

    function initWindowLayout() {
      if (!isWindow) return;
      var rect = getMapRect();
      var boxW, boxH;

      if (media.tagName === 'VIDEO' && media.videoWidth) {
        var scale = Math.min((rect.width * 0.5) / media.videoWidth, (rect.height * 0.6) / media.videoHeight);
        boxW = Math.round(media.videoWidth * scale);
        boxH = Math.round(media.videoHeight * scale);
      } else {
        boxW = Math.round(Math.min(640, rect.width * 0.6));
        boxH = Math.round(boxW * 9 / 16) + 60;
      }

      media.style.setProperty('width', boxW + 'px', 'important');
      media.style.setProperty('height', boxH + 'px', 'important');
      overlay.style.setProperty('width', boxW + 'px', 'important');
      overlay.style.setProperty('height', (boxH + WINDOW_HANDLE_HEIGHT) + 'px', 'important');
      overlay.style.setProperty('left', Math.round(rect.left + rect.width / 2 - boxW / 2) + 'px', 'important');
      overlay.style.setProperty('top', Math.round(rect.top + rect.height / 2 - boxH / 2) + 'px', 'important');
    }

    function closeOverlay() {
      if (media && media.tagName === 'VIDEO') {
        media.pause();
        if (media.src.indexOf('blob:') === 0) URL.revokeObjectURL(media.src);
      }
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateMapLayout);
      if (onDragMove) document.removeEventListener('mousemove', onDragMove);
      if (onDragEnd) document.removeEventListener('mouseup', onDragEnd);
      if (onWindowResizeMove) document.removeEventListener('mousemove', onWindowResizeMove);
      if (onWindowResizeEnd) document.removeEventListener('mouseup', onWindowResizeEnd);
      overlay.remove();
    }

    if (youTubeId || driveId) {
      media = document.createElement('iframe');
      media.src = youTubeId
        ? 'https://www.youtube.com/embed/' + youTubeId + '?autoplay=1&mute=0&rel=0&playsinline=1'
        : 'https://drive.google.com/file/d/' + driveId + '/preview';
      media.allow = 'autoplay; encrypted-media';
      media.setAttribute('frameborder', '0');
      overlay.appendChild(media);

      if (!isFloating) {
        media.style.setProperty('width', '100%', 'important');
        media.style.setProperty('height', '100%', 'important');
      }
      media.style.setProperty('border', 'none', 'important');

      if (isWindow) initWindowLayout();
    } else {
      media = document.createElement('video');
      media.src = url;
      media.autoplay = true;
      media.muted = false;
      media.controls = isFloating;
      media.referrerPolicy = 'no-referrer';
      overlay.appendChild(media);

      media.style.setProperty('object-fit', 'contain', 'important');
      if (!isFloating) {
        media.style.setProperty('width', '100%', 'important');
        media.style.setProperty('height', '100%', 'important');
      }
      if (isWindow) {
        media.addEventListener('loadedmetadata', initWindowLayout);
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

    if (isWindow && resizeHandle) {
      var resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0, isResizing = false;
      var MIN_WINDOW_W = 160, MIN_WINDOW_H = 90 + WINDOW_HANDLE_HEIGHT;

      resizeHandle.addEventListener('mousedown', function (e) {
        isResizing = true;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        var r = overlay.getBoundingClientRect();
        resizeStartW = r.width;
        resizeStartH = r.height;
        e.preventDefault();
        e.stopPropagation();
      });

      onWindowResizeMove = function (e) {
        if (!isResizing) return;
        var newW = Math.max(MIN_WINDOW_W, resizeStartW + (e.clientX - resizeStartX));
        var newH = Math.max(MIN_WINDOW_H, resizeStartH + (e.clientY - resizeStartY));
        overlay.style.setProperty('width', newW + 'px', 'important');
        overlay.style.setProperty('height', newH + 'px', 'important');
        media.style.setProperty('width', newW + 'px', 'important');
        media.style.setProperty('height', (newH - WINDOW_HANDLE_HEIGHT) + 'px', 'important');
      };
      onWindowResizeEnd = function () { isResizing = false; };

      document.addEventListener('mousemove', onWindowResizeMove);
      document.addEventListener('mouseup', onWindowResizeEnd);
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
          showAudioUnlockPrompt(media, overlay);
        });
      }
    }
  }

  var CUE_STALE_THRESHOLD_MS = 10000;
  var processedCues = {};

  function handleCueText(text) {
    var m = text.match(CUE_PATTERN);
    if (!m) return;

    var cueKey = m[0];
    if (processedCues[cueKey]) return;
    processedCues[cueKey] = true;

    var url = m[1];
    var startAt = parseInt(m[2], 10);
    var mode = m[3];

    var delay = startAt - Date.now();
    if (delay < -CUE_STALE_THRESHOLD_MS) return;

    function schedulePlayback(resolvedUrl) {
      var remaining = startAt - Date.now();
      if (remaining <= 0) {
        playCutscene(resolvedUrl, mode);
      } else {
        setTimeout(function () { playCutscene(resolvedUrl, mode); }, remaining);
      }
    }

    if (extractTwitterStatusId(url)) {
      resolveTwitterVideoUrl(url).then(function (resolvedUrl) {
        schedulePlayback(resolvedUrl);
      }).catch(function () {});
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
            handleCueText(text);
          }
        });
      });
    });

    observer.observe(chatLog, { childList: true, subtree: true });
  }

  function startWhenReady() {
    setTimeout(init, 2000);
  }

  if (document.readyState === 'complete') {
    startWhenReady();
  } else {
    window.addEventListener('load', startWhenReady);
  }
})();
