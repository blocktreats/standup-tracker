// ============================================
// WORKUP — Setup Page
// Handles Google OAuth flow for org connection
// ============================================

(function () {
  'use strict';

  var SCOPES = 'https://www.googleapis.com/auth/meetings.space.readonly email profile';

  function getBaseUrl() {
    return window.location.origin;
  }

  // Check URL params on load
  function init() {
    var params = new URLSearchParams(window.location.search);

    if (params.get('success') === 'true') {
      showView('success');
      var domain = params.get('domain');
      if (domain) {
        document.getElementById('success-message').textContent =
          domain + ' has been linked to CapyUp. Participants from your org will now be auto-detected.';
      }
    } else if (params.get('error')) {
      showView('error');
      var error = params.get('error');
      var msg = 'There was a problem connecting your account.';
      if (error === 'access_denied') {
        msg = 'You declined the permission request. CapyUp needs meeting access to auto-detect participants.';
      } else if (error === 'no_refresh_token') {
        msg = 'Google did not provide a refresh token. Please try again — make sure to click "Allow" on the consent screen.';
      } else if (error !== 'unknown') {
        msg = 'Error: ' + error;
      }
      document.getElementById('error-message').textContent = msg;
    }

    // Check that config has OAuth client ID
    var config = window.STANDUP_CONFIG;
    if (!config || !config.oauthClientId || config.oauthClientId === 'YOUR_OAUTH_CLIENT_ID') {
      var btn = document.getElementById('connect-btn');
      btn.disabled = true;
      btn.textContent = 'Setup not configured yet';
    }
  }

  function showView(name) {
    document.getElementById('view-connect').classList.add('hidden');
    document.getElementById('view-success').classList.add('hidden');
    document.getElementById('view-error').classList.add('hidden');
    document.getElementById('view-' + name).classList.remove('hidden');
  }

  // Start OAuth flow
  window.startOAuth = function () {
    var config = window.STANDUP_CONFIG;
    var redirectUri = getBaseUrl() + '/api/auth/callback';

    var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
      + '?client_id=' + encodeURIComponent(config.oauthClientId)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&response_type=code'
      + '&scope=' + encodeURIComponent(SCOPES)
      + '&access_type=offline'
      + '&prompt=consent';

    window.location.href = authUrl;
  };

  document.addEventListener('DOMContentLoaded', init);
})();
