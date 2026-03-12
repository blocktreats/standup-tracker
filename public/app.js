// ============================================
// STANDUP TRACKER — Google Meet Add-on
// Powered by Supabase Realtime
// ============================================

(function () {
  'use strict';

  // ---- State ----
  var sb; // Supabase client
  var meetingId = null;
  var myId = localStorage.getItem('standup-id');
  var myName = localStorage.getItem('standup-name') || '';
  var timerInterval = null;
  var channel = null;

  if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem('standup-id', myId);
  }

  var $ = function (sel) { return document.querySelector(sel); };

  // ---- Initialize ----

  async function init() {
    var config = window.STANDUP_CONFIG;
    if (!config || config.supabaseUrl === 'YOUR_SUPABASE_URL') {
      showError('Please update config.js with your Supabase and Cloud project settings. See README.md.');
      return;
    }

    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    // Meet SDK
    try {
      var meetSession = await meet.addon.createAddonSession({
        cloudProjectNumber: config.cloudProjectNumber,
      });
      var sidePanelClient = await meetSession.createSidePanelClient();
      var info = await sidePanelClient.getMeetingInfo();
      meetingId = sanitize(info.meetingId);
    } catch (e) {
      console.warn('Meet SDK unavailable, using test mode:', e.message || e);
      meetingId = 'test-' + new Date().toISOString().slice(0, 10);
    }

    if (myName) {
      join();
    } else {
      showNamePrompt();
    }
  }

  // ---- Name Prompt ----

  function showNamePrompt() {
    $('#loading').classList.add('hidden');
    $('#name-overlay').classList.remove('hidden');
    var input = $('#name-input');
    input.focus();

    var submitted = false;
    var submit = function () {
      if (submitted) return;
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      submitted = true;
      myName = name;
      localStorage.setItem('standup-name', myName);
      $('#name-overlay').classList.add('hidden');
      $('#loading').classList.remove('hidden');
      join();
    };

    $('#name-submit').addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
  }

  function changeName() {
    var newName = prompt('Enter your new name:', myName);
    if (newName && newName.trim() && newName.trim() !== myName) {
      myName = newName.trim();
      localStorage.setItem('standup-name', myName);
      loadThenSave(function (data) {
        if (data.participants && data.participants[myId]) {
          data.participants[myId].name = myName;
        }
        return data;
      });
      $('#my-name-display').textContent = myName;
    }
  }

  // ---- Data helpers ----

  async function loadMeetingData() {
    var { data, error } = await sb
      .from('meetings')
      .select('data')
      .eq('id', meetingId)
      .maybeSingle();
    if (error) { console.error('Load error:', error); return null; }
    return data ? data.data : null;
  }

  async function saveMeetingData(meetingData) {
    var { error } = await sb
      .from('meetings')
      .upsert({ id: meetingId, data: meetingData, updated_at: new Date().toISOString() });
    if (error) console.error('Save error:', error);
  }

  // Read-modify-write helper
  async function loadThenSave(modifyFn) {
    var data = await loadMeetingData();
    if (!data) return;
    data = modifyFn(data);
    if (data) await saveMeetingData(data);
  }

  // ---- Join Meeting ----

  async function join() {
    // Get or create meeting row
    var existing = await loadMeetingData();
    var meetingData;

    if (!existing) {
      meetingData = { state: 'lobby', participants: {} };
    } else {
      meetingData = existing;
    }

    // Add self
    if (!meetingData.participants) meetingData.participants = {};
    if (!meetingData.participants[myId]) {
      meetingData.participants[myId] = {
        name: myName,
        status: 'waiting',
        joinedAt: Date.now(),
      };
      // If standup already active, append to speaking order
      if (meetingData.state === 'active') {
        if (!meetingData.speakingOrder) meetingData.speakingOrder = [];
        if (meetingData.speakingOrder.indexOf(myId) === -1) {
          meetingData.speakingOrder.push(myId);
        }
      }
    } else {
      meetingData.participants[myId].name = myName;
    }

    await saveMeetingData(meetingData);

    // Show UI
    $('#loading').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#my-name-display').textContent = myName;
    $('#change-name').addEventListener('click', changeName);

    // Initial render
    render(meetingData);

    // Subscribe to real-time changes
    channel = sb
      .channel('meeting-' + meetingId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'meetings',
        filter: 'id=eq.' + meetingId,
      }, function (payload) {
        if (payload.new && payload.new.data) {
          render(payload.new.data);
        }
      })
      .subscribe();
  }

  // ---- Render ----

  function render(data) {
    if (!data) return;

    var state = data.state || 'lobby';
    var participants = data.participants || {};
    var order = data.speakingOrder || [];
    var currentIndex = data.currentIndex || 0;

    // Timer
    var timerEl = $('#timer');
    if (state === 'active' && data.startedAt) {
      timerEl.classList.remove('hidden');
      startTimer(data.startedAt);
    } else {
      timerEl.classList.add('hidden');
      stopTimer();
    }

    switch (state) {
      case 'lobby':  renderLobby(participants); break;
      case 'active': renderActive(participants, order, currentIndex); break;
      case 'complete': renderComplete(participants, order); break;
    }
  }

  function renderLobby(participants) {
    var list = $('#participant-list');
    var actions = $('#actions');

    var sorted = Object.entries(participants)
      .sort(function (a, b) { return (a[1].joinedAt || 0) - (b[1].joinedAt || 0); });

    var html = '';
    if (sorted.length === 0) {
      html = '<div class="empty-state">Waiting for participants to join...</div>';
    } else {
      html = '<div class="section-label">Participants (' + sorted.length + ')</div>';
      sorted.forEach(function (entry, i) {
        var id = entry[0];
        var p = entry[1];
        var isMe = id === myId;
        html += '<div class="participant' + (isMe ? ' is-me' : '') + '">'
          + '<span class="participant-number">' + (i + 1) + '</span>'
          + '<span class="participant-name">' + esc(p.name) + (isMe ? ' (you)' : '') + '</span>'
          + (isMe ? '' : '<button class="remove-btn" onclick="StandupApp.removeParticipant(\'' + id + '\')" title="Remove">&times;</button>')
          + '</div>';
      });
    }
    list.innerHTML = html;

    var canStart = sorted.length >= 1;
    actions.innerHTML = '<div class="action-buttons">'
      + '<button class="btn btn-secondary"' + (canStart ? '' : ' disabled') + ' onclick="StandupApp.startStandup(true)">Shuffle & Start</button>'
      + '<button class="btn btn-primary"' + (canStart ? '' : ' disabled') + ' onclick="StandupApp.startStandup(false)">Start in Order</button>'
      + '</div>';
  }

  function renderActive(participants, order, currentIndex) {
    var list = $('#participant-list');
    var actions = $('#actions');

    var total = order.length;
    var done = 0;
    for (var i = 0; i < currentIndex && i < total; i++) done++;
    var pctDone = total > 0 ? Math.round((done / total) * 100) : 0;

    var html = '<div class="section-label">Progress: ' + done + ' / ' + total + '</div>'
      + '<div class="progress-bar"><div class="progress-fill" style="width:' + pctDone + '%"></div></div>';

    order.forEach(function (id, i) {
      var p = participants[id];
      if (!p) return;

      var statusClass, statusIcon;
      if (p.status === 'skipped') {
        statusClass = 'skipped';
        statusIcon = '&#8211;';
      } else if (i < currentIndex) {
        statusClass = 'done';
        statusIcon = '&#10003;';
      } else if (i === currentIndex) {
        statusClass = 'speaking';
        statusIcon = '&#9654;';
      } else {
        statusClass = 'waiting';
        statusIcon = '&#8226;';
      }

      var isMe = id === myId;
      html += '<div class="participant ' + statusClass + (isMe ? ' is-me' : '') + '">'
        + '<span class="participant-status">' + statusIcon + '</span>'
        + '<span class="participant-name">' + esc(p.name) + (isMe ? ' (you)' : '') + '</span>'
        + '</div>';
    });

    // Late joiners not in speaking order
    Object.entries(participants).forEach(function (entry) {
      var id = entry[0];
      var p = entry[1];
      if (order.indexOf(id) === -1) {
        var isMe = id === myId;
        html += '<div class="participant waiting' + (isMe ? ' is-me' : '') + '">'
          + '<span class="participant-status">&#8226;</span>'
          + '<span class="participant-name">' + esc(p.name) + (isMe ? ' (you)' : '') + ' (joined late)</span>'
          + '</div>';
      }
    });

    list.innerHTML = html;

    var currentSpeaker = order[currentIndex] && participants[order[currentIndex]];
    var speakerName = currentSpeaker ? esc(currentSpeaker.name) : '?';

    actions.innerHTML = '<div class="current-speaker">Speaking: <strong>' + speakerName + '</strong></div>'
      + '<div class="action-buttons">'
      + '<button class="btn btn-secondary" onclick="StandupApp.skipSpeaker()">Skip</button>'
      + '<button class="btn btn-primary" onclick="StandupApp.advanceSpeaker()">Done &rarr; Next</button>'
      + '</div>';
  }

  function renderComplete(participants, order) {
    var list = $('#participant-list');
    var actions = $('#actions');

    var html = '<div class="section-label complete-label">Standup Complete!</div>';
    (order || []).forEach(function (id) {
      var p = participants[id];
      if (!p) return;
      var isMe = id === myId;
      var statusClass = p.status === 'skipped' ? 'skipped' : 'done';
      var statusIcon = p.status === 'skipped' ? '&#8211;' : '&#10003;';
      html += '<div class="participant ' + statusClass + '">'
        + '<span class="participant-status">' + statusIcon + '</span>'
        + '<span class="participant-name">' + esc(p.name) + (isMe ? ' (you)' : '') + '</span>'
        + '</div>';
    });
    list.innerHTML = html;

    actions.innerHTML = '<button class="btn btn-primary" onclick="StandupApp.resetStandup()">New Standup</button>';
  }

  // ---- Actions ----

  async function startStandup(shuffle) {
    var data = await loadMeetingData();
    if (!data || !data.participants) return;

    var ids = Object.keys(data.participants);
    if (ids.length === 0) return;

    if (shuffle) {
      for (var i = ids.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
      }
    } else {
      ids.sort(function (a, b) {
        return (data.participants[a].joinedAt || 0) - (data.participants[b].joinedAt || 0);
      });
    }

    // Reset all statuses and mark first speaker
    Object.keys(data.participants).forEach(function (id) {
      data.participants[id].status = 'waiting';
    });
    data.participants[ids[0]].status = 'speaking';

    data.state = 'active';
    data.speakingOrder = ids;
    data.currentIndex = 0;
    data.startedAt = Date.now();

    await saveMeetingData(data);
  }

  async function advanceSpeaker() {
    await loadThenSave(function (data) {
      if (data.state !== 'active') return data;

      var order = data.speakingOrder || [];
      var currentIdx = data.currentIndex || 0;

      if (data.participants && data.participants[order[currentIdx]]) {
        data.participants[order[currentIdx]].status = 'done';
      }

      var nextIdx = currentIdx + 1;
      if (nextIdx < order.length) {
        data.currentIndex = nextIdx;
        if (data.participants && data.participants[order[nextIdx]]) {
          data.participants[order[nextIdx]].status = 'speaking';
        }
      } else {
        data.state = 'complete';
      }

      return data;
    });
  }

  async function skipSpeaker() {
    await loadThenSave(function (data) {
      if (data.state !== 'active') return data;

      var order = data.speakingOrder || [];
      var currentIdx = data.currentIndex || 0;

      if (data.participants && data.participants[order[currentIdx]]) {
        data.participants[order[currentIdx]].status = 'skipped';
      }

      var nextIdx = currentIdx + 1;
      if (nextIdx < order.length) {
        data.currentIndex = nextIdx;
        if (data.participants && data.participants[order[nextIdx]]) {
          data.participants[order[nextIdx]].status = 'speaking';
        }
      } else {
        data.state = 'complete';
      }

      return data;
    });
  }

  async function resetStandup() {
    await loadThenSave(function (data) {
      if (data.participants) {
        Object.keys(data.participants).forEach(function (id) {
          data.participants[id].status = 'waiting';
        });
      }
      data.state = 'lobby';
      data.speakingOrder = null;
      data.currentIndex = null;
      data.startedAt = null;
      return data;
    });
  }

  async function removeParticipant(id) {
    await loadThenSave(function (data) {
      if (data.participants) {
        delete data.participants[id];
      }
      return data;
    });
  }

  // ---- Timer ----

  function startTimer(startedAt) {
    stopTimer();
    var tick = function () {
      var elapsed = Math.floor((Date.now() - startedAt) / 1000);
      var el = $('#timer');
      if (el) el.textContent = formatTime(elapsed);
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60).toString().padStart(2, '0');
    var s = (seconds % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }

  // ---- Utilities ----

  function sanitize(key) {
    return key.replace(/[.#$\[\]\/]/g, '_');
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showError(msg) {
    $('#loading').innerHTML = '<div class="error">' + esc(msg) + '</div>';
  }

  // ---- Public API ----
  window.StandupApp = {
    startStandup: startStandup,
    advanceSpeaker: advanceSpeaker,
    skipSpeaker: skipSpeaker,
    resetStandup: resetStandup,
    removeParticipant: removeParticipant,
  };

  // ---- Boot ----
  document.addEventListener('DOMContentLoaded', init);
})();
