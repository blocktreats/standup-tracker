// ============================================
// STANDUP TRACKER — Simple Checklist Mode
// Tap a name to mark them done. Syncs in real-time.
// ============================================

(function () {
  'use strict';

  var sb;
  var meetingId = null;
  var meetingCode = null;
  var myId = localStorage.getItem('standup-id');
  var myName = localStorage.getItem('standup-name') || '';
  var timerInterval = null;
  var channel = null;
  var tokenClient = null;
  var accessToken = null;
  var pollInterval = null;

  if (!myId) {
    myId = crypto.randomUUID();
    localStorage.setItem('standup-id', myId);
  }

  var $ = function (sel) { return document.querySelector(sel); };

  // ---- Initialize ----

  async function init() {
    var config = window.STANDUP_CONFIG;
    if (!config || config.supabaseUrl === 'YOUR_SUPABASE_URL') {
      showError('Please update config.js with your Supabase settings.');
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
      meetingCode = info.meetingCode;
    } catch (e) {
      console.warn('Meet SDK unavailable, using test mode:', e.message || e);
      meetingId = 'test-' + new Date().toISOString().slice(0, 10);
      meetingCode = null;
    }

    // Google Identity Services
    if (config.oauthClientId && config.oauthClientId !== 'YOUR_OAUTH_CLIENT_ID') {
      initGoogleAuth(config.oauthClientId);
    } else if (myName) {
      join();
    } else {
      showNamePrompt();
    }
  }

  // ---- Google Auth ----

  function initGoogleAuth(clientId) {
    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        auto_select: true,
        cancel_on_tap_outside: false,
      });
      google.accounts.id.prompt(function (notification) {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          if (myName) {
            joinAndFetchParticipants(clientId);
          } else {
            showNamePrompt(function () {
              joinAndFetchParticipants(clientId);
            });
          }
        }
      });
    } catch (e) {
      console.warn('GIS init failed:', e);
      if (myName) join();
      else showNamePrompt();
    }
  }

  function handleCredentialResponse(response) {
    try {
      var payload = JSON.parse(atob(response.credential.split('.')[1]));
      myName = payload.name || payload.email || myName;
      myId = 'google-' + payload.sub;
      localStorage.setItem('standup-id', myId);
      localStorage.setItem('standup-name', myName);
    } catch (e) {
      console.warn('Failed to decode ID token:', e);
    }
    joinAndFetchParticipants(window.STANDUP_CONFIG.oauthClientId);
  }

  function joinAndFetchParticipants(clientId) {
    join();
    if (meetingCode && clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/meetings.space.readonly',
        callback: handleTokenResponse,
        prompt: '',
      });
      tokenClient.requestAccessToken();
    }
  }

  function handleTokenResponse(response) {
    if (response.error) {
      console.warn('OAuth token error:', response.error);
      return;
    }
    accessToken = response.access_token;
    fetchMeetParticipants();
    // Poll for new participants every 30s
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(fetchMeetParticipants, 30000);
  }

  async function fetchMeetParticipants() {
    if (!accessToken || !meetingCode) return;
    try {
      var resp = await fetch(
        'https://meet.googleapis.com/v2/conferenceRecords?filter=space.meeting_code%3D'
        + encodeURIComponent(meetingCode),
        { headers: { Authorization: 'Bearer ' + accessToken } }
      );
      var data = await resp.json();
      if (!data.conferenceRecords || data.conferenceRecords.length === 0) return;

      var record = data.conferenceRecords[data.conferenceRecords.length - 1];
      var partResp = await fetch(
        'https://meet.googleapis.com/v2/' + record.name + '/participants',
        { headers: { Authorization: 'Bearer ' + accessToken } }
      );
      var partData = await partResp.json();
      if (!partData.participants || partData.participants.length === 0) return;

      await mergeApiParticipants(partData.participants);
    } catch (e) {
      console.error('Failed to fetch Meet participants:', e);
    }
  }

  async function mergeApiParticipants(apiParticipants) {
    var meetingData = await loadMeetingData();
    if (!meetingData) meetingData = { participants: {} };
    if (!meetingData.participants) meetingData.participants = {};

    var changed = false;
    apiParticipants.forEach(function (p) {
      var displayName = null;
      var participantId = null;

      if (p.signedinUser) {
        displayName = p.signedinUser.displayName;
        var userId = (p.signedinUser.user || '').replace('users/', '');
        if (userId) participantId = 'google-' + userId;
      } else if (p.anonymousUser) {
        displayName = p.anonymousUser.displayName;
      } else if (p.phoneUser) {
        displayName = p.phoneUser.displayName;
      }

      if (!displayName) return;
      if (!participantId) {
        participantId = 'meet-' + displayName.toLowerCase().replace(/\s+/g, '-');
      }

      if (!meetingData.participants[participantId]) {
        meetingData.participants[participantId] = {
          name: displayName,
          done: false,
        };
        changed = true;
      }
    });

    if (changed) await saveMeetingData(meetingData);
  }

  // ---- Name Prompt (fallback) ----

  function showNamePrompt(onComplete) {
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
      if (onComplete) onComplete();
      else join();
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

  async function loadThenSave(modifyFn) {
    var data = await loadMeetingData();
    if (!data) data = { participants: {} };
    data = modifyFn(data);
    if (data) await saveMeetingData(data);
  }

  // ---- Join ----

  async function join() {
    var existing = await loadMeetingData();
    var meetingData = existing || { participants: {} };
    if (!meetingData.participants) meetingData.participants = {};

    // Add self
    if (!meetingData.participants[myId]) {
      meetingData.participants[myId] = { name: myName, done: false };
    } else {
      meetingData.participants[myId].name = myName;
    }

    await saveMeetingData(meetingData);

    // Show UI
    $('#loading').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#my-name-display').textContent = myName;
    $('#change-name').addEventListener('click', changeName);

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

    var entries = Object.entries(participants).sort(function (a, b) {
      // Waiting first, done at bottom; alphabetical within each group
      if (a[1].done !== b[1].done) return a[1].done ? 1 : -1;
      return (a[1].name || '').localeCompare(b[1].name || '');
    });

    var total = entries.length;
    var doneCount = entries.filter(function (e) { return e[1].done; }).length;

    var html = '';
    if (total === 0) {
      html = '<div class="empty-state">No participants yet.<br>Waiting for Meet API...</div>';
    } else {
      html = '<div class="section-label">' + doneCount + ' / ' + total + ' done</div>';

      var pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
      html += '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>';

      entries.forEach(function (entry) {
        var id = entry[0];
        var p = entry[1];
        var isMe = id === myId;
        var statusClass = p.done ? 'done' : 'waiting';

        html += '<div class="participant clickable ' + statusClass + (isMe ? ' is-me' : '') + '" onclick="StandupApp.toggleDone(\'' + id + '\')">'
          + avatarHtml(p.name)
          + '<div class="participant-info">'
          + '<span class="participant-name">' + esc(p.name) + (isMe ? ' <span class="you-tag">(you)</span>' : '') + '</span>'
          + '<span class="participant-meta">' + (p.done ? 'Done' : 'Waiting') + '</span>'
          + '</div>'
          + '<div class="check-toggle ' + (p.done ? 'checked' : '') + '">'
          + (p.done ? checkSvg() : circleSvg())
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
      actions.innerHTML = '<button class="btn btn-secondary" onclick="StandupApp.reset()">Reset</button>';
    } else {
      actions.innerHTML = '<button class="btn btn-primary btn-glow" onclick="StandupApp.start()"'
        + (total === 0 ? ' disabled' : '') + '>Start Standup</button>';
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

  // ---- Actions ----

  async function toggleDone(id) {
    await loadThenSave(function (data) {
      if (data.participants && data.participants[id]) {
        data.participants[id].done = !data.participants[id].done;
      }
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
        });
      }
      data.startedAt = null;
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
    start: start,
    reset: reset,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
