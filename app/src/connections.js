/* Dependency-free ES5 syntax; Promise and fetch are runtime requirements. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(root); }
  else { root.C2Connections = factory(root); }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  function error(code, message, status) {
    var failure = new Error(message);
    failure.code = code;
    if (status !== undefined) { failure.status = status; }
    return failure;
  }
  function number(value) { return typeof value === 'number' && isFinite(value); }
  function coordinates(latitude, longitude) {
    return number(latitude) && number(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  }
  function text(value) { return typeof value === 'string' ? value : ''; }
  function baseUrl(value) {
    if (typeof value !== 'string' || !/^https?:\/\/[^/]/i.test(value) || /%2f|%5c/i.test(value) || /[\s\\?#\x00-\x1f\x7f]/.test(value) || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(value)) {
      throw error('INVALID_URL', 'Use an HTTP(S) Jellyfin base URL without credentials, query or fragment.');
    }
    try {
      var parsed = new root.URL(value);
      if (!parsed.hostname || parsed.username || parsed.password || /@/.test(value.split('/')[2])) { throw new Error(); }
      return parsed.href.replace(/\/+$/, '');
    } catch (ignored) { throw error('INVALID_URL', 'Use a valid HTTP(S) Jellyfin base URL.'); }
  }
  var clientAuthorization = 'MediaBrowser Client="C2 Home", Device="LG webOS", DeviceId="c2-home", Version="0.1.0"';
  var shelfContainers = { Season: 1, Series: 1, BoxSet: 1, Playlist: 1, Folder: 1, CollectionFolder: 1, MusicAlbum: 1, PhotoAlbum: 1 };
  var finishedPercent = 85;
  function progressOf(item) {
    var user = item.UserData || {}, progress = 0;
    if (number(user.PlayedPercentage)) { progress = user.PlayedPercentage; }
    else if (number(user.PlaybackPositionTicks) && number(item.RunTimeTicks) && item.RunTimeTicks > 0) {
      progress = 100 * user.PlaybackPositionTicks / item.RunTimeTicks;
    }
    return Math.max(0, Math.min(100, progress));
  }
  function shelfItems(data) {
    if (!data || !Array.isArray(data.Items)) { throw error('INVALID_RESPONSE', 'Invalid Jellyfin shelf response.'); }
    return data.Items.filter(function (item) {
      return item && text(item.Id) && text(item.Name) && !shelfContainers[text(item.Type)];
    });
  }
  function mapItem(item) {
    var title = item.Name, subtitle = '';
    if (item.Type === 'Episode' && text(item.SeriesName)) {
      title = item.SeriesName;
      subtitle = (number(item.ParentIndexNumber) ? 'S' + item.ParentIndexNumber + ' ' : '') +
        (number(item.IndexNumber) ? 'E' + item.IndexNumber + ' · ' : '') + item.Name;
    } else if (number(item.ProductionYear)) { subtitle = String(item.ProductionYear); }
    var mapped = { id: item.Id, title: title, subtitle: subtitle, type: text(item.Type) || 'Unknown', progress: progressOf(item) };
    if (text(item.SeriesId)) { mapped.seriesId = item.SeriesId; }
    return mapped;
  }
  /* Jellyfin keeps an item in Resume until its 90% MaxResumePct, so credits-only
     episodes linger. Treat 85%+ as finished; when the series has a next-up
     episode, promote that into Continue watching instead of leaving a gap. */
  function shelves(resumeData, nextData) {
    var resumeRaw = shelfItems(resumeData), nextRaw = shelfItems(nextData), seen = {}, blocked = {}, resume = [], slots = {};
    resumeRaw.forEach(function (item) {
      var key = text(item.SeriesId) || text(item.Id), paid = item.UserData && item.UserData.Played === true;
      if (seen[key] || blocked[key] || paid) { return; }
      if (progressOf(item) >= finishedPercent) { blocked[key] = 1; slots[key] = resume.length; resume.push(null); return; }
      seen[key] = 1;
      resume.push(mapItem(item));
    });
    nextRaw.forEach(function (item) {
      var key = text(item.SeriesId) || text(item.Id);
      if (seen[key]) { return; }
      seen[key] = 1;
      var mapped = mapItem(item);
      mapped.upNext = true;
      if (Object.prototype.hasOwnProperty.call(slots, key)) { resume[slots[key]] = mapped; }
      else { resume.push(mapped); }
    });
    return { items: resume.filter(function (item) { return item; }).slice(0, 12) };
  }
  function create(options) {
    options = options || {};
    var fetch = options.fetch || root.fetch;
    var timeoutMs = number(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(120000, options.timeoutMs) : 10000;
    var state = 'active', pending = [];
    function stateError() { return state === 'active' ? null : error(state === 'disposed' ? 'DISPOSED' : 'PAUSED', 'Connections are ' + state + '.'); }
    function networkError(failure) {
      return failure && failure.name === 'AbortError' ? error('ABORTED', 'Request was aborted.') :
        error('NETWORK', 'Network request failed. Check the address, network and server CORS settings.');
    }
    function request(url, init, group) {
      var failure = stateError();
      if (failure) { return Promise.reject(failure); }
      if (pending.length >= 4) { return Promise.reject(error('BUSY', 'The connection request limit has been reached.')); }
      return new Promise(function (resolve, reject) {
        var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        var entry = { done: false, cancel: function (reason) { finish(reason); } };
        var timer;
        function finish(reason, data) {
          if (entry.done) { return; }
          entry.done = true;
          root.clearTimeout(timer);
          var index = pending.indexOf(entry);
          if (index !== -1) { pending.splice(index, 1); }
          if (reason) {
            if (entry.cancelBody) { entry.cancelBody(); }
            if (controller) { try { controller.abort(); } catch (ignored) {} }
            reject(reason);
          } else { resolve(data); }
        }
        pending.push(entry);
        if (group) { group.push(entry); }
        timer = root.setTimeout(function () { finish(error('TIMEOUT', 'Request timed out.')); }, timeoutMs);
        init = init || {};
        var config = { method: init.method || 'GET', headers: init.headers || {}, credentials: 'omit', redirect: 'error', cache: 'no-store' };
        if (init.body !== undefined) { config.body = init.body; }
        if (controller) { config.signal = controller.signal; }
        Promise.resolve().then(function () {
          if (entry.done) { return null; }
          if (typeof fetch !== 'function') { throw new Error(); }
          return fetch.call(root, url, config);
        }).then(function (response) {
          if (!entry.done) { return readResponse(response, entry); }
        }, function (reason) { throw networkError(reason); }).then(function (data) {
          finish(null, data);
        }, function (reason) { finish(reason); });
      });
    }
    function readBody(response, entry) {
      if (response.body && typeof response.body.getReader === 'function' && typeof root.TextDecoder === 'function') {
        var reader = response.body.getReader(), decoder = new root.TextDecoder('utf-8'), size = 0, chunks = [];
        entry.cancelBody = function () {
          entry.cancelBody = null;
          try { Promise.resolve(reader.cancel()).then(function () {}, function () {}); } catch (ignored) {}
        };
        function read() {
          if (entry.done) { return ''; }
          return Promise.resolve().then(function () { return reader.read(); }).then(function (chunk) {
            if (entry.done) { return ''; }
            if (chunk.done) { entry.cancelBody = null; return chunks.join('') + decoder.decode(); }
            size += chunk.value.byteLength;
            if (size > 262144) { throw error('PAYLOAD_TOO_LARGE', 'Response exceeds the payload limit.'); }
            chunks.push(decoder.decode(chunk.value, { stream: true }));
            return read();
          }, function (reason) { throw networkError(reason); });
        }
        return read();
      }
      if (typeof response.text !== 'function') { throw error('INVALID_RESPONSE', 'JSON response body unavailable.'); }
      return Promise.resolve().then(function () { return response.text(); }).then(null, function (reason) { throw networkError(reason); });
    }
    function readResponse(response, entry) {
      return Promise.resolve().then(function () {
        if (!response || typeof response.status !== 'number') { throw error('INVALID_RESPONSE', 'Invalid HTTP response.'); }
        if (response.status < 200 || response.status >= 300) {
          throw error(response.status === 401 || response.status === 403 ? 'AUTH' : 'HTTP', 'Request failed (HTTP ' + response.status + ').', response.status);
        }
        var length = response.headers && response.headers.get('Content-Length');
        if (length && Number(length) > 262144) { throw error('PAYLOAD_TOO_LARGE', 'Response exceeds the payload limit.'); }
        return Promise.resolve().then(function () { return readBody(response, entry); }).then(function (body) {
          if (typeof body !== 'string') { throw error('INVALID_RESPONSE', 'Invalid JSON response.'); }
          if (body.length > 262144) { throw error('PAYLOAD_TOO_LARGE', 'Response exceeds the payload limit.'); }
          var data;
          try { data = JSON.parse(body); } catch (ignored) { throw error('INVALID_RESPONSE', 'Invalid JSON response.'); }
          if (!data || typeof data !== 'object' || Array.isArray(data)) { throw error('INVALID_RESPONSE', 'Invalid JSON response.'); }
          return data;
        });
      });
    }
    function guarded(method) {
      return function (input) {
        var failure = stateError();
        if (failure) { return Promise.reject(failure); }
        try { return Promise.resolve(method(input)); } catch (reason) { return Promise.reject(reason); }
      };
    }
    function cancelAll() {
      pending.slice().forEach(function (entry) { entry.cancel(stateError()); });
    }
    var api = {
      searchCities: function (query) {
        query = text(query).trim();
        if (!query) { return Promise.resolve([]); }
        return request('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=5&language=en&format=json')
          .then(function (data) {
            return (Array.isArray(data.results) ? data.results : []).filter(function (city) {
              return city && text(city.name) && coordinates(city.latitude, city.longitude);
            }).slice(0, 5).map(function (city) {
              var name = text(city.name), country = text(city.country);
              return { name: name, country: country, latitude: city.latitude, longitude: city.longitude,
                label: [name, text(city.admin1), country].filter(function (part) { return part; }).join(', ') };
            });
          });
      },
      fetchWeather: function (input) {
        input = input || {};
        var units = input.units || 'celsius';
        if (!coordinates(input.latitude, input.longitude) || (units !== 'celsius' && units !== 'fahrenheit')) {
          return Promise.reject(error('INVALID_INPUT', 'Valid coordinates and temperature units are required.'));
        }
        return request('https://api.open-meteo.com/v1/forecast?latitude=' + input.latitude + '&longitude=' + input.longitude +
          '&current=temperature_2m,weather_code,is_day&temperature_unit=' + units).then(function (data) {
          var current = data.current;
          if (!current || !number(current.temperature_2m) || !number(current.weather_code) ||
              (current.is_day !== 0 && current.is_day !== 1)) { throw error('INVALID_RESPONSE', 'Invalid weather response.'); }
          return { temperature: current.temperature_2m, code: current.weather_code, isDay: current.is_day === 1,
            unit: units === 'celsius' ? '°C' : '°F', fetchedAt: Date.now() };
        });
      },
      signInJellyfin: function (input) {
        input = input || {};
        var url;
        try { url = baseUrl(input.url); } catch (failure) { return Promise.reject(failure); }
        if (!text(input.username).trim() || typeof input.password !== 'string') {
          return Promise.reject(error('INVALID_INPUT', 'A username and password string are required.'));
        }
        return request(url + '/Users/AuthenticateByName', {
          method: 'POST', credentials: 'omit', redirect: 'error',
          headers: { Authorization: clientAuthorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ Username: input.username, Pw: input.password })
        }).then(function (data) {
          if (!text(data.AccessToken) || !data.User || !text(data.User.Id)) {
            throw error('INVALID_RESPONSE', 'Jellyfin did not return a valid session.');
          }
          return { url: url, token: data.AccessToken, userId: data.User.Id, userName: text(data.User.Name) };
        });
      },
      fetchShelves: function (session) {
        session = session || {};
        var url;
        try { url = baseUrl(session.url); } catch (failure) { return Promise.reject(failure); }
        if (!text(session.userId) || !text(session.token) || /[^\x21\x23-\x5b\x5d-\x7e]/.test(session.token)) {
          return Promise.reject(error('INVALID_INPUT', 'A valid in-memory Jellyfin session is required.'));
        }
        var init = { method: 'GET', credentials: 'omit', redirect: 'error', headers: { Authorization: clientAuthorization + ', Token="' + session.token + '"' } };
        if (pending.length > 2) { return Promise.reject(error('BUSY', 'Two connection slots are required for shelves.')); }
        var group = [];
        var fields = '&limit=12&enableImages=false';
        return Promise.all([
          request(url + '/UserItems/Resume?userId=' + encodeURIComponent(session.userId) + fields, init, group),
          request(url + '/Shows/NextUp?userId=' + encodeURIComponent(session.userId) + fields, init, group)
        ]).then(function (lists) { return shelves(lists[0], lists[1]); }).then(null, function (reason) {
          group.forEach(function (entry) { entry.cancel(reason); });
          throw reason;
        });
      },
      pause: function () { if (state !== 'disposed') { state = 'paused'; cancelAll(); } },
      resume: function () { if (state !== 'disposed') { state = 'active'; } },
      dispose: function () { state = 'disposed'; cancelAll(); }
    };
    ['searchCities', 'fetchWeather', 'signInJellyfin', 'fetchShelves'].forEach(function (name) { api[name] = guarded(api[name]); });
    return api;
  }
  return { create: create };
}));
