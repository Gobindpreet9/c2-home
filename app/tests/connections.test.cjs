'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const modulePath = require.resolve('../src/connections.js', { paths: [__dirname] });
const connections = require(modulePath);

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(value)) };
}
function transport(values) {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(response(values.shift())); };
  return { calls, fetch };
}

test('city search normalizes valid choices, caps results and encodes the query', async () => {
  const tx = transport([{ results: [
    { name: 'Springfield', country: 'United States', admin1: 'Illinois', latitude: 39.8, longitude: -89.6 },
    { name: 'Bad', latitude: null, longitude: 1 },
    ...Array.from({ length: 8 }, (_, i) => ({ name: 'Town ' + i, country: 'X', latitude: i, longitude: i }))
  ] }]);
  const api = connections.create({ fetch: tx.fetch });
  assert.deepEqual(await api.searchCities('Spring & field'), [
    { name: 'Springfield', country: 'United States', latitude: 39.8, longitude: -89.6, label: 'Springfield, Illinois, United States' },
    ...Array.from({ length: 4 }, (_, i) => ({ name: 'Town ' + i, country: 'X', latitude: i, longitude: i, label: 'Town ' + i + ', X' }))
  ]);
  const url = new URL(tx.calls[0].url);
  assert.equal(url.origin, 'https://geocoding-api.open-meteo.com');
  assert.equal(url.pathname, '/v1/search');
  assert.equal(url.searchParams.get('name'), 'Spring & field');
  assert.equal(url.searchParams.get('count'), '5');
  assert.equal(url.searchParams.get('language'), 'en');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.deepEqual(await api.searchCities('  '), []);
  assert.equal(tx.calls.length, 1);
});

test('weather fetch normalizes both unit choices and validates coordinates', async () => {
  const tx = transport([
    { current: { temperature_2m: 16.5, weather_code: 3, is_day: 1 } },
    { current: { temperature_2m: 61.7, weather_code: 0, is_day: 0 } }
  ]);
  const api = connections.create({ fetch: tx.fetch });
  for (const units of ['celsius', 'fahrenheit']) {
    const before = Date.now();
    const result = await api.fetchWeather({ latitude: 0, longitude: -1.2, units });
    assert.equal(result.temperature, units === 'celsius' ? 16.5 : 61.7);
    assert.equal(result.unit, units === 'celsius' ? '°C' : '°F');
    assert.equal(result.isDay, units === 'celsius');
    assert.equal(result.code, units === 'celsius' ? 3 : 0);
    assert.ok(result.fetchedAt >= before && result.fetchedAt <= Date.now());
    const url = new URL(tx.calls[tx.calls.length - 1].url);
    assert.equal(url.origin, 'https://api.open-meteo.com');
    assert.equal(url.searchParams.get('latitude'), '0');
    assert.equal(url.searchParams.get('current'), 'temperature_2m,weather_code,is_day');
    assert.equal(url.searchParams.get('temperature_unit'), units);
  }
  for (const options of [{ latitude: null, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: Infinity }, { latitude: 0, longitude: 0, units: 'kelvin' }]) {
    await assert.rejects(api.fetchWeather(options), { code: 'INVALID_INPUT' });
  }
  assert.equal(tx.calls.length, 2);
});

test('Jellyfin authentication posts credentials only in body and returns only a session', async () => {
  const tx = transport([{ AccessToken: 'fixture-token', User: { Id: 'fixture-user', Name: 'TV' }, ServerId: 'ignored' }]);
  const api = connections.create({ fetch: tx.fetch });
  const session = await api.signInJellyfin({ url: 'http://192.168.1.2:8096/jellyfin///', username: 'TV', password: '' });
  assert.deepEqual(session, { url: 'http://192.168.1.2:8096/jellyfin', token: 'fixture-token', userId: 'fixture-user', userName: 'TV' });
  assert.equal(tx.calls[0].url, session.url + '/Users/AuthenticateByName');
  assert.equal(tx.calls[0].init.method, 'POST');
  assert.equal(tx.calls[0].init.headers.Authorization, 'MediaBrowser Client="C2 Home", Device="LG webOS", DeviceId="c2-home", Version="0.1.0"');
  assert.equal(tx.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(tx.calls[0].init.body), { Username: 'TV', Pw: '' });
  assert.equal(tx.calls[0].init.credentials, 'omit');
  assert.equal(tx.calls[0].init.redirect, 'error');
});

test('Jellyfin rejects unsafe base URLs without fetching, but permits LAN hosts and IPv6', async () => {
  const tx = transport(Array.from({ length: 4 }, () => ({ AccessToken: 'fixture', User: { Id: 'id', Name: 'TV' } })));
  const api = connections.create({ fetch: tx.fetch });
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://host', '//host', 'http://user:pass@host', 'http://host?x=1', 'http://host#x', 'http://host?', 'http://host#', 'http://host/\\evil', 'http://host/%2e%2e/secret', 'http://', 'http://host\n', 'https://host:99999']) {
    await assert.rejects(api.signInJellyfin({ url, username: 'TV', password: '' }), { code: 'INVALID_URL' });
  }
  assert.equal(tx.calls.length, 0);
  for (const url of ['http://localhost:8096', 'http://jellyfin.local:8096/base', 'http://10.0.0.1', 'http://[::1]:8096']) {
    assert.equal((await api.signInJellyfin({ url, username: 'TV', password: '' })).url, url);
  }
  assert.equal(tx.calls.length, 4);
  await assert.rejects(api.signInJellyfin({ url: 'http://host', username: '', password: '' }), { code: 'INVALID_INPUT' });
});

test('shelves use header-only token and normalize bounded lists without exposing raw server data', async () => {
  const episode = { Id: 'ep/1', Name: 'Pilot', Type: 'Episode', SeriesName: 'Series', ParentIndexNumber: 1, IndexNumber: 2,
    RunTimeTicks: 400, UserData: { PlaybackPositionTicks: 100 }, Secret: 'ignored' };
  const movie = { Id: 'm1', Name: 'Movie', Type: 'Movie', ProductionYear: 2025, UserData: { PlayedPercentage: 60 } };
  const tx = transport([{ Items: [null, {}, episode, movie, ...Array.from({ length: 20 }, (_, i) => ({ Id: 'x' + i, Name: 'Title' }))] },
    { Items: [{ ...episode, UserData: { PlayedPercentage: -10 } }] }]);
  const api = connections.create({ fetch: tx.fetch });
  const session = { url: 'https://lan.local/jellyfin/', token: 'fixture-token', userId: 'user/id' };
  const shelves = await api.fetchShelves(session);
  assert.equal(shelves.items.length, 12);
  assert.deepEqual(shelves.items[0], { id: 'ep/1', title: 'Series', subtitle: 'S1 E2 · Pilot', type: 'Episode', progress: 25 });
  assert.deepEqual(shelves.items[1], { id: 'm1', title: 'Movie', subtitle: '2025', type: 'Movie', progress: 60 });
  const grouped = connections.create({ fetch: transport([
    { Items: [
      { Id: 'e1', Name: 'One', Type: 'Episode', SeriesId: 's1', SeriesName: 'Show', ParentIndexNumber: 3, IndexNumber: 1, UserData: { PlayedPercentage: 40 } },
      { Id: 'e2', Name: 'Two', Type: 'Episode', SeriesId: 's1', SeriesName: 'Show', ParentIndexNumber: 3, IndexNumber: 2, UserData: { PlayedPercentage: 20 } },
      { Id: 'e3', Name: 'Three', Type: 'Episode', SeriesId: 's2', SeriesName: 'Other', ParentIndexNumber: 1, IndexNumber: 1, UserData: { PlayedPercentage: 10 } },
      { Id: 'season', Name: 'Season 3', Type: 'Season', SeriesId: 's1' }
    ] },
    { Items: [{ Id: 'e4', Name: 'Next', Type: 'Episode', SeriesId: 's1', SeriesName: 'Show', UserData: {} }] }
  ]).fetch });
  const groupedShelves = await grouped.fetchShelves({ url: 'http://lan:8096', token: 'fixture-token', userId: 'u1' });
  assert.deepEqual(groupedShelves.items.map(x => x.id), ['e1', 'e3']);
  const credits = { Id: 'ep19', Name: 'The Basement', Type: 'Episode', SeriesId: 'aot', SeriesName: 'Attack on Titan', ParentIndexNumber: 3, IndexNumber: 19, RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 893 } };
  const almost = { Id: 'ep11', Name: 'Idol', Type: 'Episode', SeriesId: 'aot2', SeriesName: 'Other Show', ParentIndexNumber: 1, IndexNumber: 11, RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 835 } };
  const finishedMovie = { Id: 'm9', Name: 'Finished', Type: 'Movie', ProductionYear: 2024, UserData: { PlayedPercentage: 92 } };
  const alreadyPlayed = { Id: 'old', Name: 'Old', Type: 'Episode', SeriesId: 'aot', SeriesName: 'Attack on Titan', ParentIndexNumber: 2, IndexNumber: 4, RunTimeTicks: 1000, UserData: { PlayedPercentage: 8, Played: true } };
  const nextUp = { Id: 'ep410', Name: 'A Sound Argument', Type: 'Episode', SeriesId: 'aot', SeriesName: 'Attack on Titan', ParentIndexNumber: 4, IndexNumber: 10, UserData: {} };
  const creditsApi = connections.create({ fetch: transport([{ Items: [credits, alreadyPlayed, almost, finishedMovie] }, { Items: [nextUp] }]).fetch });
  const creditsShelves = await creditsApi.fetchShelves({ url: 'http://lan:8096', token: 'fixture-token', userId: 'u1' });
  assert.deepEqual(creditsShelves.items.map(x => x.id), ['ep410', 'ep11']);
  assert.equal(creditsShelves.items[0].upNext, true);
  assert.equal(creditsShelves.items[0].subtitle, 'S4 E10 · A Sound Argument');

  assert.equal(tx.calls.length, 2);
  assert.equal(new URL(tx.calls[0].url).pathname, '/jellyfin/UserItems/Resume');
  assert.equal(new URL(tx.calls[1].url).pathname, '/jellyfin/Shows/NextUp');
  assert.equal(new URL(tx.calls[0].url).searchParams.get('userId'), 'user/id');
  assert.equal(new URL(tx.calls[1].url).searchParams.get('userId'), 'user/id');
  for (const call of tx.calls) {
    const url = new URL(call.url);
    assert.equal(url.searchParams.get('limit'), '12');
    assert.equal(url.searchParams.get('enableImages'), 'false');
    assert.equal(url.searchParams.has('fields'), false);
    assert.ok(!call.url.includes(session.token));
    assert.equal(call.init.headers.Authorization, 'MediaBrowser Client="C2 Home", Device="LG webOS", DeviceId="c2-home", Version="0.1.0", Token="fixture-token"');
  }
  for (const bad of [{ ...session, token: 'bad"token' }, { ...session, token: 'bad\ntoken' }, { ...session, userId: '' }]) {
    await assert.rejects(api.fetchShelves(bad), { code: 'INVALID_INPUT' });
  }
  assert.equal(tx.calls.length, 2);
});

test('HTTP authentication and network failures are explicit and never echo response bodies or transport errors', async () => {
  for (const status of [401, 403, 404, 500]) {
    const api = connections.create({ fetch: () => Promise.resolve(response({ secret: 'fixture-sensitive' }, status)) });
    await assert.rejects(api.searchCities('Town'), e => e.code === (status === 401 || status === 403 ? 'AUTH' : 'HTTP') && e.status === status && !String(e).includes('fixture-sensitive'));
  }
  const api = connections.create({ fetch: () => Promise.reject(new Error('fixture-sensitive URL/token')) });
  await assert.rejects(api.searchCities('Town'), e => e.code === 'NETWORK' && !String(e).includes('fixture-sensitive'));
});

test('malformed JSON, malformed successful schemas, and excessive payloads reject explicitly', async () => {
  for (const res of [
    { ...response({}), text: () => Promise.resolve('not JSON') },
    response(null),
    { ...response({}), headers: { get: () => '262145' }, text: () => { throw Error('must not read oversized body'); } },
    { ...response({}), text: () => Promise.resolve(' '.repeat(262145)) }
  ]) {
    const api = connections.create({ fetch: () => Promise.resolve(res) });
    await assert.rejects(api.searchCities('Town'), e => ['INVALID_RESPONSE', 'PAYLOAD_TOO_LARGE'].includes(e.code));
  }
  const api = connections.create({ fetch: () => Promise.resolve(response({})) });
  await assert.rejects(api.fetchWeather({ latitude: 0, longitude: 0 }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(api.signInJellyfin({ url: 'http://host', username: 'TV', password: '' }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(api.fetchShelves({ url: 'http://host', userId: 'id', token: 'fixture' }), { code: 'INVALID_RESPONSE' });
});

test('finite timeout aborts a hung transport and body read, including without AbortController', async () => {
  let signal;
  const api = connections.create({ timeoutMs: 15, fetch: (url, init) => { signal = init.signal; return new Promise(() => {}); } });
  await assert.rejects(api.searchCities('Town'), { code: 'TIMEOUT' });
  assert.equal(signal.aborted, true);
  const bodyApi = connections.create({ timeoutMs: 15, fetch: () => Promise.resolve({ ...response({}), text: () => new Promise(() => {}) }) });
  await assert.rejects(bodyApi.searchCities('Town'), { code: 'TIMEOUT' });
  const context = { Promise, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
  const fallback = context.C2Connections.create({ timeoutMs: 15, fetch: () => new Promise(() => {}) });
  await assert.rejects(fallback.searchCities('Town'), { code: 'TIMEOUT' });
});

test('default and invalid timeout values use 10000ms; excessive timeout is capped', async () => {
  for (const [value, expected] of [[undefined, 10000], [0, 10000], [-5, 10000], [Infinity, 10000], ['1', 10000], [999999, 120000]]) {
    const delays = [], cleared = [];
    const context = { Promise, setTimeout: (fn, ms) => { delays.push(ms); return 7; }, clearTimeout: id => cleared.push(id) };
    vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
    const api = context.C2Connections.create({ timeoutMs: value, fetch: () => Promise.resolve(response({})) });
    await api.searchCities('Town');
    assert.deepEqual(delays, [expected]);
    assert.deepEqual(cleared, [7]);
  }
});

test('pause aborts outstanding work, rejects all calls until resume, and never revives stale results', async () => {
  let finish;
  const calls = [];
  const api = connections.create({ fetch: (url, init) => { calls.push(init); return new Promise(resolve => { finish = resolve; }); } });
  const pending = api.searchCities('Town');
  const rejection = assert.rejects(pending, { code: 'PAUSED' });
  await new Promise(resolve => setImmediate(resolve));
  api.pause();
  api.pause();
  await rejection;
  assert.equal(calls[0].signal.aborted, true);
  for (const call of [() => api.searchCities(''), () => api.fetchWeather({}), () => api.signInJellyfin({}), () => api.fetchShelves({})]) {
    await assert.rejects(call(), { code: 'PAUSED' });
  }
  finish(response({ results: [{ name: 'Stale', latitude: 0, longitude: 0 }] }));
  api.resume();
  assert.deepEqual(await api.searchCities(''), []);
  assert.equal(calls.length, 1);
  api.dispose();
});

test('dispose is permanent, aborts requests and blocks every API even after resume', async () => {
  let signal;
  const api = connections.create({ fetch: (url, init) => { signal = init.signal; return new Promise(() => {}); } });
  const pending = api.searchCities('Town');
  const rejected = assert.rejects(pending, { code: 'DISPOSED' });
  await new Promise(resolve => setImmediate(resolve));
  api.dispose(); api.dispose(); api.resume(); api.pause();
  await rejected;
  assert.equal(signal.aborted, true);
  for (const call of [() => api.searchCities(''), () => api.fetchWeather({}), () => api.signInJellyfin({}), () => api.fetchShelves({})]) {
    await assert.rejects(call(), { code: 'DISPOSED' });
  }
});

test('pause before dispatch does not call fetch; concurrent requests are capped with no retries', async () => {
  let calls = 0;
  const api = connections.create({ fetch: () => { calls++; return new Promise(() => {}); } });
  const pre = assert.rejects(api.searchCities('Town'), { code: 'PAUSED' });
  api.pause();
  await pre;
  assert.equal(calls, 0);
  api.resume();
  const pending = Array.from({ length: 4 }, () => api.searchCities('Town'));
  const failures = pending.map(p => assert.rejects(p, { code: 'PAUSED' }));
  await assert.rejects(api.searchCities('overflow'), { code: 'BUSY' });
  assert.equal(calls, 4);
  api.pause();
  await Promise.all(failures);
  api.dispose();
});

test('a transport AbortError rejects as ABORTED without echoing its message', async () => {
  const api = connections.create({ fetch: () => Promise.reject(Object.assign(new Error('fixture-sensitive'), { name: 'AbortError' })) });
  await assert.rejects(api.searchCities('Town'), e => e.code === 'ABORTED' && !String(e).includes('fixture-sensitive'));
});

test('shelf capacity is reserved atomically and a failed shelf cancels its sibling', async () => {
  const signals = [];
  const api = connections.create({ fetch: (url, init) => { signals.push(init.signal); return new Promise(() => {}); } });
  const work = Array.from({ length: 3 }, () => api.searchCities('Town'));
  const rejected = work.map(p => assert.rejects(p, { code: 'PAUSED' }));
  await assert.rejects(api.fetchShelves({ url: 'http://host', userId: 'id', token: 'fixture' }), { code: 'BUSY' });
  assert.equal(signals.length, 3);
  api.pause();
  await Promise.all(rejected);
  const siblings = [];
  const failApi = connections.create({ fetch: (url, init) => {
    siblings.push(init.signal);
    return url.includes('/Resume?') ? Promise.resolve(response({}, 401)) : new Promise(() => {});
  } });
  await assert.rejects(failApi.fetchShelves({ url: 'http://host', userId: 'id', token: 'fixture' }), { code: 'AUTH' });
  assert.equal(siblings.length, 2);
  assert.equal(siblings[1].aborted, true);
  failApi.dispose();
});

test('streaming JSON is byte bounded and cancels its reader on oversized content or pause', async () => {
  let cancelled = 0;
  const api = connections.create({ fetch: () => Promise.resolve({ ...response({}),
    body: { getReader: () => ({ read: () => Promise.resolve({ done: false, value: new Uint8Array(262145) }), cancel: () => { cancelled++; return Promise.resolve(); } }) },
    text: () => { throw Error('must not buffer stream'); }
  }) });
  await assert.rejects(api.searchCities('Town'), { code: 'PAYLOAD_TOO_LARGE' });
  assert.equal(cancelled, 1);
  let reading;
  const ready = new Promise(resolve => { reading = resolve; });
  const pauseApi = connections.create({ fetch: () => Promise.resolve({ ...response({}),
    body: { getReader: () => ({ read: () => { reading(); return new Promise(() => {}); }, cancel: () => { cancelled++; return Promise.resolve(); } }) }
  }) });
  const pending = assert.rejects(pauseApi.searchCities('Town'), { code: 'PAUSED' });
  await ready;
  pauseApi.pause();
  await pending;
  assert.equal(cancelled, 2);
});

test('URL validation refuses ambiguous empty authorities and encoded path separators', async () => {
  let calls = 0;
  const api = connections.create({ fetch: () => { calls++; return Promise.resolve(response({})); } });
  for (const url of ['http:////host', 'https:///host', 'http://host/base%2f..%2fsecret', 'http://host/base%5csecret']) {
    await assert.rejects(api.signInJellyfin({ url, username: 'TV', password: '' }), { code: 'INVALID_URL' });
  }
  assert.equal(calls, 0);
});

test('browser global fetch works without storage, location, logging or automatic requests', async () => {
  const calls = [];
  const context = { Promise, URL, setTimeout, clearTimeout,
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve(response({})); } };
  for (const name of ['localStorage', 'sessionStorage', 'navigator', 'location', 'console']) {
    Object.defineProperty(context, name, { get() { throw Error('forbidden access: ' + name); } });
  }
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
  const api = context.C2Connections.create();
  assert.equal(calls.length, 0);
  const cities = await api.searchCities('Town');
  assert.equal(cities.length, 0);
  assert.equal(calls.length, 1);
  api.dispose();
});

test('native streaming Response decodes split UTF-8 safely', async () => {
  const body = new TextEncoder().encode(JSON.stringify({ results: [{ name: 'Zürich', country: 'Switzerland', latitude: 47.4, longitude: 8.5 }] }));
  const api = connections.create({ fetch: () => Promise.resolve(new Response(new ReadableStream({
    start(controller) { for (const byte of body) controller.enqueue(Uint8Array.of(byte)); controller.close(); }
  }))) });
  const result = await api.searchCities('Zürich');
  assert.equal(result[0].name, 'Zürich');
  assert.equal(result[0].label, 'Zürich, Switzerland');
});

test('pause without AbortController still settles pending calls and suppresses late results', async () => {
  let complete;
  const context = { Promise, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
  const api = context.C2Connections.create({ fetch: () => new Promise(resolve => { complete = resolve; }) });
  const pending = assert.rejects(api.searchCities('Town'), { code: 'PAUSED' });
  await new Promise(resolve => setImmediate(resolve));
  api.pause();
  await pending;
  api.resume();
  complete(response({ results: [] }));
  assert.equal((await api.searchCities('')).length, 0);
  api.dispose();
});

test('CommonJS and browser expose the same lazy create API', () => {
  let calls = 0;
  const context = { Promise, setTimeout, clearTimeout, fetch: () => { calls++; } };
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
  assert.equal(typeof connections.create, 'function');
  assert.deepEqual(Object.keys(context.C2Connections), Object.keys(connections));
  const api = context.C2Connections.create();
  assert.deepEqual(Object.keys(api).sort(), ['dispose', 'fetchShelves', 'fetchWeather', 'pause', 'resume', 'searchCities', 'signInJellyfin'].sort());
  assert.equal(calls, 0);
  api.dispose();
});
