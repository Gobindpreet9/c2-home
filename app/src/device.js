/* ES5 syntax; requires the host's Promise and timer APIs. No browser success shim. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.C2Device = factory(root);
  }
}(typeof self !== 'undefined' ? self : typeof global !== 'undefined' ? global : this, function (root) {
  'use strict';

  function failure(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  /* Candidate IDs, not evidence that these apps are installed on a particular TV. */
  var defaults = {
    moonfin: 'org.moonfin.webos',
    moonlight: 'com.limelight.webos',
    youtube: 'youtube.leanback.v4',
    pc: 'com.webos.app.hdmi1',
    ps5: 'com.webos.app.hdmi2',
    lgHome: 'com.webos.app.home'
  };

  function create(options) {
    options = options === undefined ? {} : options;
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw failure('INVALID_OPTIONS', 'options must be an object.');
    }
    var apps = {};
    var key;
    var overrides = options.apps;
    if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) {
      throw failure('INVALID_OPTIONS', 'apps must be an object of fixed action overrides.');
    }
    for (key in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) { apps[key] = defaults[key]; }
    }
    for (key in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
          throw failure('INVALID_OPTIONS', 'Unknown action override: ' + key);
        }
        var id = overrides[key];
        if (typeof id !== 'string' || id.length > 255 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
          throw failure('INVALID_APP_ID', 'Invalid app ID for ' + key + '.');
        }
        apps[key] = id;
      }
    }
    var bridgeFactory = options.bridgeFactory;
    if (bridgeFactory !== undefined && typeof bridgeFactory !== 'function') {
      throw failure('INVALID_OPTIONS', 'bridgeFactory must be a function.');
    }
    if (bridgeFactory === undefined && typeof root.PalmServiceBridge === 'function') {
      bridgeFactory = function () { return new root.PalmServiceBridge(); };
    }
    var available = typeof bridgeFactory === 'function';
    var timeoutMs = options.timeoutMs === undefined ? 8000 : options.timeoutMs;
    if (typeof timeoutMs !== 'number' || !isFinite(timeoutMs) ||
        timeoutMs < 1 || timeoutMs > 2147483647 || Math.floor(timeoutMs) !== timeoutMs) {
      throw failure('INVALID_OPTIONS', 'timeoutMs must be an integer from 1 to 2147483647.');
    }
    /* Retain native bridges until each one-shot request settles. */
    var pending = [];
    var disposed = false;
    function request(method, action, params) {
      if (disposed) {
        return Promise.reject(failure('DEVICE_DISPOSED', 'Device adapter has been disposed.'));
      }
      if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(apps, action)) {
        return Promise.reject(failure('INVALID_ACTION', 'Unknown device action.'));
      }
      if (!available) {
        return Promise.reject(failure('DEVICE_UNAVAILABLE', 'PalmServiceBridge is unavailable.'));
      }
      return new Promise(function (resolve, reject) {
        var bridge;
        var finished = false;
        var timer;
        var entry = { bridge: bridge, finish: finish };
        pending.push(entry);
        function releaseBridge() {
          try {
            if (bridge) { bridge.onservicecallback = function () {}; }
          } catch (ignoredCallback) {}
          try {
            if (bridge && typeof bridge.cancel === 'function') { bridge.cancel(); }
          } catch (ignoredCancel) {}
        }
        function finish(error, response) {
          if (finished) { return; }
          finished = true;
          clearTimeout(timer);
          var index = pending.indexOf(entry);
          if (index !== -1) { pending.splice(index, 1); }
          releaseBridge();
          if (error) { reject(error); } else { resolve(response); }
        }
        function onResponse(raw) {
          if (finished) { return; }
          var response;
          try {
            if (typeof raw !== 'string') { throw new Error('Expected a JSON string.'); }
            response = JSON.parse(raw);
          } catch (error) {
            finish(failure('INVALID_RESPONSE', 'Invalid JSON from applicationManager.'));
            return;
          }
          if (!response || typeof response !== 'object' || Array.isArray(response) ||
              typeof response.returnValue !== 'boolean') {
            finish(failure('INVALID_RESPONSE', 'Missing boolean returnValue from applicationManager.'));
          } else if (response.returnValue !== true) {
            var serviceError = failure('SERVICE_ERROR', typeof response.errorText === 'string' ?
              response.errorText : 'applicationManager rejected the request.');
            serviceError.errorCode = response.errorCode;
            serviceError.errorText = response.errorText;
            serviceError.response = response;
            finish(serviceError);
          } else if (method === 'getAppLoadStatus' && typeof response.exist !== 'boolean') {
            finish(failure('INVALID_RESPONSE', 'Missing boolean exist from getAppLoadStatus.'));
          } else {
            finish(null, response);
          }
        }
        try {
          bridge = bridgeFactory();
          entry.bridge = bridge;
          /* An injected factory can synchronously dispose this instance. */
          if (finished) { releaseBridge(); return; }
          if (!bridge || typeof bridge.call !== 'function') { throw new Error('Bridge has no call method.'); }
          bridge.onservicecallback = onResponse;
          var payload = method === 'launch' ? { id: apps[action], launchMode: 'foreground' } : { appId: apps[action] };
          if (method === 'launch' && params && typeof params === 'object') { payload.params = params; }
          timer = setTimeout(function () {
            finish(failure('REQUEST_TIMEOUT', 'applicationManager request timed out.'));
          }, timeoutMs);
          bridge.call('luna://com.webos.applicationManager/' + method, JSON.stringify(payload));
        } catch (error) {
          var transportError = failure('TRANSPORT_ERROR', 'PalmServiceBridge request failed.');
          transportError.cause = error;
          finish(transportError);
        }
      });
    }
    return {
      isTV: available,
      launch: function (action, params) { return request('launch', action, params); },
      checkApp: function (action) {
        return request('getAppLoadStatus', action).then(function (response) { return response.exist; });
      },
      dispose: function () {
        disposed = true;
        while (pending.length) {
          pending[0].finish(failure('DEVICE_DISPOSED', 'Device adapter has been disposed.'));
        }
      }
    };
  }

  return { create: create };
}));
