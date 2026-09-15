import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';

test('Totoro fetch guard preserves Request semantics while replacing credentials', async t => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString()};
    response.setHeader('content-type', 'application/json');
    response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  process.env.LONGMAO_LOCAL_BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
  await import(`../src/integrations/totoro/totoro-fetch-guard.mjs?test=${Date.now()}`);
  const request = new Request('https://wxxcx.xtotoro.com/wxxcx/submit?part=2', {
    method: 'POST',
    headers: {authorization: 'Bearer private-runtime-token', 'content-type': 'application/json', 'x-request-marker': 'kept'},
    body: JSON.stringify({token: 'private-runtime-token', value: 7}),
  });
  const response = await fetch(request);
  assert.equal(response.ok, true);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/wxxcx/submit?part=2');
  assert.equal(received.headers.authorization, 'Bearer DEMO_SESSION');
  assert.equal(received.headers['x-request-marker'], 'kept');
  assert.deepEqual(JSON.parse(received.body), {token: 'DEMO_SESSION', value: 7});
});
