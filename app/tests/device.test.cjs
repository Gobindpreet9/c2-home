'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const devicePath = path.join(__dirname, '../src/device.js');
const load = () => require(devicePath);
const expectedApps = {
  moonfin: 'org.moonfin.webos', moonlight: 'com.limelight.webos',
  youtube: 'youtube.leanback.v4', pc: 'com.webos.app.hdmi1',
  ps5: 'com.webos.app.hdmi2', lgHome: 'com.webos.app.home'
};
function harness(options = {}) {
  const bridges = [];
  const device = load().create({
    ...options,
    bridgeFactory() {
      const bridge = {
        calls: [], cancels: 0,
        call(uri, payload) { this.calls.push({ uri, payload }); },
        cancel() { this.cancels++; }
      };
      bridges.push(bridge);
      return bridge;
    }
  });
  return { device, bridges };
}
function respond(bridge, value) {
  bridge.onservicecallback(JSON.stringify(value));
}

test('CommonJS create exposes a real unavailable-device failure in Node', async () => {
  assert.ok(fs.existsSync(devicePath), 'device adapter has not been implemented');
  const api = load();
  assert.equal(typeof api.create, 'function');
  const device = api.create();
  assert.equal(device.isTV, false);
  await assert.rejects(device.launch('youtube'), { code: 'DEVICE_UNAVAILABLE' });
  device.dispose();
});

test('launch uses each fixed candidate ID and waits for an explicit success callback', async () => {
  const { device, bridges } = harness();
  assert.equal(device.isTV, true);
  for (const [action, id] of Object.entries(expectedApps)) {
    let settled = false;
    const pending = device.launch(action);
    pending.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    const bridge = bridges.at(-1);
    assert.deepEqual(bridge.calls, [{
      uri: 'luna://com.webos.applicationManager/launch', payload: JSON.stringify({ id, launchMode: 'foreground' })
    }]);
    const result = { returnValue: true, processId: 'test-process' };
    respond(bridge, result);
    assert.deepEqual(await pending, result);
  }
  assert.equal(bridges.length, 6);
  device.dispose();
});

test('checkApp uses appId and returns the installation boolean', async () => {
  const { device, bridges } = harness();
  for (const exist of [true, false]) {
    const pending = device.checkApp('moonfin');
    assert.deepEqual(bridges.at(-1).calls, [{
      uri: 'luna://com.webos.applicationManager/getAppLoadStatus',
      payload: JSON.stringify({ appId: expectedApps.moonfin })
    }]);
    respond(bridges.at(-1), { returnValue: true, exist });
    assert.equal(await pending, exist);
  }
  device.dispose();
});

test('service failures reject with the original missing-app or permission detail', async () => {
  for (const method of ['launch', 'checkApp']) {
    for (const [errorCode, errorText] of [[-101, 'The app was not found.'], [-103, 'Security checks failed.']]) {
      const { device, bridges } = harness();
      const pending = device[method]('pc');
      const response = { returnValue: false, errorCode, errorText };
      respond(bridges[0], response);
      await assert.rejects(pending, error => {
        assert.equal(error.code, 'SERVICE_ERROR');
        assert.equal(error.errorCode, errorCode);
        assert.equal(error.errorText, errorText);
        assert.deepEqual(error.response, response);
        assert.match(error.message, new RegExp(errorText.replace(/\./g, '\\.')));
        return true;
      });
      device.dispose();
    }
  }
});

test('malformed JSON and non-boolean success responses reject instead of throwing from callbacks', async () => {
  for (const raw of ['{', '', 'null', '[]', 'true', '{}', '{"returnValue":"true"}', '{"returnValue":1}']) {
    const { device, bridges } = harness();
    const pending = device.launch('youtube');
    assert.doesNotThrow(() => bridges[0].onservicecallback(raw));
    await assert.rejects(pending, { code: 'INVALID_RESPONSE' });
    device.dispose();
  }
});

test('checkApp rejects a missing or non-boolean exist value rather than claiming absence', async () => {
  for (const exist of [undefined, null, 'false', 0]) {
    const { device, bridges } = harness();
    const pending = device.checkApp('ps5');
    respond(bridges[0], { returnValue: true, exist });
    await assert.rejects(pending, { code: 'INVALID_RESPONSE' });
    device.dispose();
  }
});

test('actions and app overrides are allowlisted, validated, and copied', async () => {
  const apps = { moonfin: 'org.custom-player.webos' };
  const { device, bridges } = harness({ apps });
  apps.moonfin = 'org.mutated.webos';
  const pending = device.launch('moonfin');
  assert.deepEqual(JSON.parse(bridges[0].calls[0].payload), { id: 'org.custom-player.webos', launchMode: 'foreground' });
  respond(bridges[0], { returnValue: true });
  await pending;
  for (const action of ['toString', '__proto__', 'constructor', 'launch', 'youtube;exec', '', null, {}, ['pc'], 1]) {
    for (const method of ['launch', 'checkApp']) {
      await assert.rejects(device[method](action), { code: 'INVALID_ACTION' });
    }
  }
  assert.equal(bridges.length, 1);
  for (const id of ['', 'with spaces', 'org/app', 'org..app', '.org', 'a'.repeat(256), null, 3, {}]) {
    assert.throws(() => load().create({ apps: { youtube: id } }), { code: 'INVALID_APP_ID' });
  }
  for (const apps of [{ shell: 'org.shell' }, JSON.parse('{"__proto__":"org.evil"}'), [], 'youtube']) {
    assert.throws(() => load().create({ apps }), { code: 'INVALID_OPTIONS' });
  }
  const inherited = Object.create({ youtube: 'org.inherited.app' });
  const second = harness({ apps: inherited });
  const normal = second.device.launch('youtube');
  assert.deepEqual(JSON.parse(second.bridges[0].calls[0].payload), { id: expectedApps.youtube, launchMode: 'foreground' });
  respond(second.bridges[0], { returnValue: true });
  await normal;
  second.device.dispose();
  device.dispose();
});

test('dispose cancels all in-flight requests, rejects promises, and ignores late or duplicate callbacks', async () => {
  const { device, bridges } = harness();
  const first = device.launch('youtube');
  const second = device.checkApp('pc');
  const firstRejection = assert.rejects(first, { code: 'DEVICE_DISPOSED' });
  const secondRejection = assert.rejects(second, { code: 'DEVICE_DISPOSED' });
  const callbacks = bridges.map(bridge => bridge.onservicecallback);
  device.dispose();
  assert.deepEqual(bridges.map(bridge => bridge.cancels), [1, 1]);
  await Promise.all([firstRejection, secondRejection]);
  for (const callback of callbacks) {
    assert.doesNotThrow(() => callback('{'));
    assert.doesNotThrow(() => callback('{"returnValue":true,"exist":true}'));
  }
  device.dispose();
  assert.deepEqual(bridges.map(bridge => bridge.cancels), [1, 1]);
  await assert.rejects(device.launch('lgHome'), { code: 'DEVICE_DISPOSED' });
  await assert.rejects(device.checkApp('lgHome'), { code: 'DEVICE_DISPOSED' });
  assert.equal(bridges.length, 2);
  const unavailable = load().create();
  unavailable.dispose();
  await assert.rejects(unavailable.launch('lgHome'), { code: 'DEVICE_DISPOSED' });
});

test('a browser global uses new PalmServiceBridge without an injected factory', async () => {
  const instances = [];
  const browser = {
    Promise, setTimeout, clearTimeout,
    PalmServiceBridge: function () {
      assert.ok(new.target, 'native bridge must be constructed');
      this.call = (uri, payload) => { this.uri = uri; this.payload = payload; };
      this.cancel = () => {};
      instances.push(this);
    }
  };
  browser.self = browser;
  vm.runInNewContext(fs.readFileSync(devicePath, 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.C2Device), Object.keys(load()));
  const device = browser.C2Device.create();
  assert.equal(device.isTV, true);
  const pending = device.launch('ps5');
  assert.equal(instances[0].uri, 'luna://com.webos.applicationManager/launch');
  assert.deepEqual(JSON.parse(instances[0].payload), { id: expectedApps.ps5, launchMode: 'foreground' });
  respond(instances[0], { returnValue: true });
  assert.equal((await pending).returnValue, true);
  device.dispose();
  const desktop = { Promise, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(devicePath, 'utf8'), desktop);
  const unavailable = desktop.C2Device.create();
  assert.equal(unavailable.isTV, false);
  await assert.rejects(unavailable.checkApp('youtube'), { code: 'DEVICE_UNAVAILABLE' });
  unavailable.dispose();
});

test('requests time out after the default 8000ms and a finite injected timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [options, duration] of [[{}, 8000], [{ timeoutMs: 25 }, 25]]) {
    for (const method of ['launch', 'checkApp']) {
      const { device, bridges } = harness(options);
      let settled = false;
      const pending = device[method]('youtube');
      const rejection = assert.rejects(pending, { code: 'REQUEST_TIMEOUT' });
      pending.then(() => { settled = true; }, () => { settled = true; });
      t.mock.timers.tick(duration - 1);
      await Promise.resolve();
      assert.equal(settled, false);
      const late = bridges[0].onservicecallback;
      t.mock.timers.tick(1);
      assert.equal(bridges[0].cancels, 1);
      await rejection;
      assert.doesNotThrow(() => late('{'));
      device.dispose();
      assert.equal(bridges[0].cancels, 1);
    }
  }
});

test('invalid options cannot disable finite timeouts or provide a non-factory transport', () => {
  for (const options of [null, [], true, 'bad', 3]) {
    assert.throws(() => load().create(options), { code: 'INVALID_OPTIONS' });
  }
  for (const timeoutMs of [0, -1, Infinity, NaN, '25', null, 2147483648, 0.5]) {
    assert.throws(() => load().create({ timeoutMs }), { code: 'INVALID_OPTIONS' });
  }
  for (const bridgeFactory of [null, {}, 3, 'bridge']) {
    assert.throws(() => load().create({ bridgeFactory }), { code: 'INVALID_OPTIONS' });
  }
});

test('factory, invalid bridge, and call exceptions reject as transport errors without leaking requests', async () => {
  const nativeError = new Error('Native transport failed');
  const bridges = [null, {}, { call: 1 }, { call() { throw nativeError; }, cancel() { this.cancelled = true; } }];
  for (const bridge of bridges) {
    const device = load().create({ bridgeFactory: () => bridge, timeoutMs: 10 });
    await assert.rejects(device.launch('pc'), { code: 'TRANSPORT_ERROR' });
    device.dispose();
    if (bridge && typeof bridge.cancel === 'function') { assert.equal(bridge.cancelled, true); }
  }
  const device = load().create({ bridgeFactory() { throw nativeError; } });
  await assert.rejects(device.launch('pc'), error => {
    assert.equal(error.code, 'TRANSPORT_ERROR');
    assert.equal(error.cause, nativeError);
    return true;
  });
  device.dispose();
});

test('dispose during bridge construction prevents a launch from escaping disposal', async () => {
  let calls = 0;
  let cancels = 0;
  let device;
  device = load().create({ bridgeFactory() {
    device.dispose();
    return { call() { calls++; }, cancel() { cancels++; } };
  } });
  await assert.rejects(device.launch('pc'), { code: 'DEVICE_DISPOSED' });
  assert.equal(calls, 0);
  assert.equal(cancels, 1);
});

test('non-string callbacks and malformed error text cannot escape the callback', async () => {
  for (const raw of [null, {}, ['bad'], { returnValue: true }]) {
    const { device, bridges } = harness();
    const pending = device.launch('youtube');
    assert.doesNotThrow(() => bridges[0].onservicecallback(raw));
    await assert.rejects(pending, { code: 'INVALID_RESPONSE' });
    device.dispose();
  }
  const { device, bridges } = harness();
  const pending = device.launch('youtube');
  const response = { returnValue: false, errorText: { toString: null } };
  assert.doesNotThrow(() => respond(bridges[0], response));
  await assert.rejects(pending, { code: 'SERVICE_ERROR' });
  device.dispose();
});

test('one-shot settlement cancels once, isolates concurrent requests, and tolerates broken cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { device, bridges } = harness();
  const launch = device.launch('moonlight');
  const check = device.checkApp('ps5');
  const saved = bridges.map(bridge => bridge.onservicecallback);
  respond(bridges[1], { returnValue: true, exist: false });
  assert.equal(await check, false);
  assert.equal(bridges[1].cancels, 1);
  assert.equal(bridges[0].cancels, 0);
  respond(bridges[0], { returnValue: true });
  await launch;
  for (const callback of saved) {
    assert.doesNotThrow(() => callback('{'));
    assert.doesNotThrow(() => callback('{"returnValue":false}'));
  }
  t.mock.timers.tick(16000);
  device.dispose();
  assert.deepEqual(bridges.map(bridge => bridge.cancels), [1, 1]);

  let late;
  let cancels = 0;
  const synchronous = load().create({ bridgeFactory() {
    const bridge = {
      call() {
        late = this.onservicecallback;
        Object.defineProperty(this, 'onservicecallback', { writable: false });
        late('{"returnValue":true}');
        throw new Error('A throw after settlement must not reverse the result');
      },
      cancel() { cancels++; late('{'); throw new Error('Cancel failed'); }
    };
    return bridge;
  } });
  assert.deepEqual(await synchronous.launch('lgHome'), { returnValue: true });
  assert.equal(cancels, 1);
  synchronous.dispose();
  t.mock.timers.tick(16000);
  assert.equal(cancels, 1);
});

test('a short real timer also rejects an unresponsive test bridge', async () => {
  const { device, bridges } = harness({ timeoutMs: 5 });
  await assert.rejects(device.launch('pc'), { code: 'REQUEST_TIMEOUT' });
  assert.equal(bridges[0].cancels, 1);
  device.dispose();
});

test('launch forwards item params for deep links', async () => {
  const { device, bridges } = harness();
  const pending = device.launch('moonfin', { itemId: 'episode-123' });
  await Promise.resolve();
  const bridge = bridges.at(-1);
  assert.deepEqual(JSON.parse(bridge.calls[0].payload), {
    id: 'org.moonfin.webos', launchMode: 'foreground', params: { itemId: 'episode-123' }
  });
  respond(bridge, { returnValue: true });
  assert.equal((await pending).returnValue, true);
});
