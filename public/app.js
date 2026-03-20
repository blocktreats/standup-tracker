// ============================================
// STANDUP TRACKER — Simple Checklist Mode
// Auto-pulls names from Meet via backend proxy.
// Tap to mark done. Syncs in real-time.
// ============================================

(function () {
  'use strict';

  var sb;
  var meetingId = null;
  var meetingCode = null;
  var timerInterval = null;
  var channel = null;
  var pollInterval = null;

  var $ = function (sel) { return document.querySelector(sel); };

  // ---- Initialize ----

  async function init() {
    var config = window.STANDUP_CONFIG;
    if (!config || config.supabaseUrl === 'YOUR_SUPABASE_URL') {
      showError('Please update config.js with your Supabase settings.');
      return;
    }

    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    // Meet SDK — for meeting ID and code
    try {
      var meetSession = await meet.addon.createAddonSession({
        cloudProjectNumber: config.cloudProjectNumber,
      });
      var sidePanelClient = await meetSession.createSidePanelClient();
      var info = await sidePanelClient.getMeetingInfo();
      meetingId = sanitize(info.meetingId);
      meetingCode = info.meetingCode;
    } catch (e) {
      console.warn('Meet SDK unavailable, using test mode:', e.message || e);
      meetingId = 'test-' + new Date().toISOString().slice(0, 10);
      meetingCode = null;
    }

    // Show app immediately
    var existing = await loadMeetingData();
    var meetingData = existing || { participants: {} };
    if (!meetingData.participants) meetingData.participants = {};
    await saveMeetingData(meetingData);

    $('#loading').classList.add('hidden');
    $('#app').classList.remove('hidden');

    // Wire up manual add input
    var input = $('#add-name-input');
    var addBtn = $('#add-name-btn');
    addBtn.addEventListener('click', function () { addParticipant(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addParticipant(input);
    });

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

    // Auto-fetch participants from Meet API via backend
    if (meetingCode) {
      fetchMeetParticipants();
      pollInterval = setInterval(fetchMeetParticipants, 15000);
    }
  }

  // ---- Meet API (via backend proxy) ----

  async function fetchMeetParticipants() {
    if (!meetingCode) return;
    try {
      var resp = await fetch('/api/participants?meetingCode=' + encodeURIComponent(meetingCode));
      if (!resp.ok) {
        console.warn('Backend returned', resp.status);
        return;
      }
      var data = await resp.json();
      if (data.participants && data.participants.length > 0) {
        await mergeApiParticipants(data.participants);
      }
    } catch (e) {
      console.error('Failed to fetch participants from backend:', e);
    }
  }

  async function mergeApiParticipants(apiParticipants) {
    var meetingData = await loadMeetingData();
    if (!meetingData) meetingData = { participants: {} };
    if (!meetingData.participants) meetingData.participants = {};

    var changed = false;
    apiParticipants.forEach(function (p) {
      if (!meetingData.participants[p.id]) {
        meetingData.participants[p.id] = { name: p.name, done: false };
        changed = true;
      }
    });

    if (changed) await saveMeetingData(meetingData);
  }

  // ---- Manual Add ----

  async function addParticipant(input) {
    var name = input.value.trim();
    if (!name) { input.focus(); return; }
    input.value = '';
    input.focus();

    var id = 'p-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36);
    await loadThenSave(function (data) {
      data.participants[id] = { name: name, done: false };
      return data;
    });
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

  async function loadThenSave(modifyFn) {
    var data = await loadMeetingData();
    if (!data) data = { participants: {} };
    data = modifyFn(data);
    if (data) await saveMeetingData(data);
  }

  // ---- Render ----

  function render(data) {
    if (!data) return;
    var participants = data.participants || {};
    var timerEl = $('#timer');

    if (data.startedAt) {
      timerEl.classList.remove('hidden');
      startTimer(data.startedAt);
    } else {
      timerEl.classList.add('hidden');
      stopTimer();
    }

    var list = $('#participant-list');
    var actions = $('#actions');

    // Use shuffled order if it exists, otherwise sort alphabetically
    var order = data.shuffledOrder || null;
    var entries = Object.entries(participants).sort(function (a, b) {
      // Skipped always at bottom
      if (a[1].skipped !== b[1].skipped) return a[1].skipped ? 1 : -1;
      // Done above skipped but below waiting
      if (a[1].done !== b[1].done) return a[1].done ? 1 : -1;
      // If shuffled, use shuffle order
      if (order) {
        var ai = order.indexOf(a[0]);
        var bi = order.indexOf(b[0]);
        if (ai === -1) ai = 9999;
        if (bi === -1) bi = 9999;
        return ai - bi;
      }
      return (a[1].name || '').localeCompare(b[1].name || '');
    });

    var activeEntries = entries.filter(function (e) { return !e[1].skipped; });
    var total = activeEntries.length;
    var doneCount = activeEntries.filter(function (e) { return e[1].done; }).length;

    var html = '';
    if (total === 0) {
      html = '<div class="empty-state">Waiting for participants...</div>';
    } else {
      html = '<div class="section-label">' + doneCount + ' / ' + total + ' done</div>';

      var pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
      html += '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>';

      entries.forEach(function (entry) {
        var id = entry[0];
        var p = entry[1];
        var statusClass = p.skipped ? 'skipped' : (p.done ? 'done' : 'waiting');
        var statusText = p.skipped ? 'Skipped' : (p.done ? 'Done' : 'Waiting');

        html += '<div class="participant clickable ' + statusClass + '">'
          + '<div class="participant-left" onclick="StandupApp.toggleDone(\'' + id + '\')">'
          + avatarHtml(p.name)
          + '<div class="participant-info">'
          + '<span class="participant-name">' + esc(p.name) + '</span>'
          + '<span class="participant-meta">' + statusText + '</span>'
          + '</div>'
          + '</div>'
          + '<div class="participant-right">'
          + '<div class="check-toggle ' + (p.done ? 'checked' : '') + '" onclick="StandupApp.toggleDone(\'' + id + '\')">'
          + (p.done ? checkSvg() : circleSvg())
          + '</div>'
          + '<button class="skip-btn" onclick="StandupApp.toggleSkip(\'' + id + '\')" title="' + (p.skipped ? 'Unskip' : 'Skip') + '">'
          + skipSvg(p.skipped)
          + '</button>'
          + '<button class="remove-btn" onclick="StandupApp.remove(\'' + id + '\')" title="Remove">&times;</button>'
          + '</div>'
          + '</div>';
      });
    }
    list.innerHTML = html;

    // Footer
    var hasStarted = !!data.startedAt;
    var allDone = total > 0 && doneCount === total;

    if (allDone && hasStarted) {
      var elapsed = Math.floor((Date.now() - data.startedAt) / 1000);
      actions.innerHTML = '<div class="complete-banner">'
        + '<img src="capy-su.png" alt="" width="24" height="24" class="complete-icon">'
        + ' All done in ' + formatTime(elapsed) + '!'
        + '</div>'
        + '<button class="btn btn-primary btn-glow" onclick="StandupApp.reset()">New Standup</button>';
    } else if (allDone) {
      actions.innerHTML = '<div class="complete-banner">'
        + '<img src="capy-su.png" alt="" width="24" height="24" class="complete-icon">'
        + ' All done!'
        + '</div>'
        + '<button class="btn btn-primary btn-glow" onclick="StandupApp.reset()">New Standup</button>';
    } else if (hasStarted) {
      actions.innerHTML = '<div class="action-buttons">'
        + '<button class="btn btn-secondary" onclick="StandupApp.shuffle()" title="Shuffle order">' + shuffleSvg() + ' Shuffle</button>'
        + '<button class="btn btn-secondary" onclick="StandupApp.reset()">Reset</button>'
        + '</div>';
    } else {
      actions.innerHTML = '<div class="action-buttons">'
        + '<button class="btn btn-secondary" onclick="StandupApp.shuffle()" title="Shuffle order"' + (total === 0 ? ' disabled' : '') + '>' + shuffleSvg() + ' Shuffle</button>'
        + '<button class="btn btn-primary" onclick="StandupApp.start()"' + (total === 0 ? ' disabled' : '') + '>Start Standup</button>'
        + '</div>';
    }
  }

  function checkSvg() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>'
      + '<polyline points="22 4 12 14.01 9 11.01"/>'
      + '</svg>';
  }

  function circleSvg() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
      + '<circle cx="12" cy="12" r="10"/>'
      + '</svg>';
  }

  function skipSvg(isSkipped) {
    if (isSkipped) {
      // Undo/unskip icon
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<polyline points="1 4 1 10 7 10"/>'
        + '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'
        + '</svg>';
    }
    // Skip icon (forward arrow)
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<polygon points="5 4 15 12 5 20 5 4"/>'
      + '<line x1="19" y1="5" x2="19" y2="19"/>'
      + '</svg>';
  }

  function shuffleSvg() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="16 3 21 3 21 8"/>'
      + '<line x1="4" y1="20" x2="21" y2="3"/>'
      + '<polyline points="21 16 21 21 16 21"/>'
      + '<line x1="15" y1="15" x2="21" y2="21"/>'
      + '<line x1="4" y1="4" x2="9" y2="9"/>'
      + '</svg>';
  }

  // ---- Actions ----

  async function toggleDone(id) {
    await loadThenSave(function (data) {
      if (data.participants && data.participants[id] && !data.participants[id].skipped) {
        data.participants[id].done = !data.participants[id].done;
      }
      return data;
    });
  }

  async function removeParticipant(id) {
    await loadThenSave(function (data) {
      if (data.participants) delete data.participants[id];
      // Remove from shuffle order too
      if (data.shuffledOrder) {
        data.shuffledOrder = data.shuffledOrder.filter(function (x) { return x !== id; });
      }
      return data;
    });
  }

  async function toggleSkip(id) {
    await loadThenSave(function (data) {
      if (data.participants && data.participants[id]) {
        data.participants[id].skipped = !data.participants[id].skipped;
        // Unskip also un-dones
        if (!data.participants[id].skipped) {
          data.participants[id].done = false;
        }
      }
      return data;
    });
  }

  async function shuffle() {
    await loadThenSave(function (data) {
      var ids = Object.keys(data.participants || {}).filter(function (id) {
        return !data.participants[id].skipped;
      });
      // Fisher-Yates shuffle
      for (var i = ids.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = ids[i];
        ids[i] = ids[j];
        ids[j] = tmp;
      }
      data.shuffledOrder = ids;
      return data;
    });
  }

  async function start() {
    await loadThenSave(function (data) {
      data.startedAt = Date.now();
      return data;
    });
  }

  async function reset() {
    await loadThenSave(function (data) {
      if (data.participants) {
        Object.keys(data.participants).forEach(function (id) {
          data.participants[id].done = false;
          data.participants[id].skipped = false;
        });
      }
      data.startedAt = null;
      data.shuffledOrder = null;
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

  function getInitials(name) {
    return (name || '?').split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
  }

  var avatarColors = [
    '#0ba5ec', '#0086c9', '#026aa2', '#36bffa', '#7cd4fd',
    '#065986', '#0b4a6f', '#14b8a6', '#10b981', '#06b6d4',
    '#3b82f6', '#b9e6fe',
  ];

  function getAvatarColor(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
  }

  function avatarHtml(name) {
    return '<div class="avatar" style="background:' + getAvatarColor(name) + '">' + esc(getInitials(name)) + '</div>';
  }

  // ---- Public API ----
  window.StandupApp = {
    toggleDone: toggleDone,
    toggleSkip: toggleSkip,
    remove: removeParticipant,
    shuffle: shuffle,
    start: start,
    reset: reset,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
