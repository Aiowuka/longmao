import {createServer} from 'node:http';
import {sanitize} from '../integrations/wmpf/sanitizer.mjs';

const TASK = {
  taskId: 'demo-paper', name: 'Longmao local contract experiment', startDate: '2026-01-01', endDate: '2099-12-31',
  mileage: '0.20', minTime: '1', maxTime: '2', fitDegree: '1.00',
  runTimeRuleList: [{startTime: '00:00:00', endTime: '23:59:59'}],
  runPointList: [{taskId: 'demo-paper', pointId: 'demo-line', pointName: 'Synthetic closed route', longitude: '0', latitude: '0',
    pointList: [{longitude: '0', latitude: '0'}, {longitude: '0.002', latitude: '0'}, {longitude: '0.002', latitude: '0.002'}, {longitude: '0', latitude: '0.002'}]}],
};

const replies = new Map([
  ['/wxxcx/platform/camera/currentTimeMillis', {status: '00', code: '0', body: 1}],
  ['/wxxcx/platform/sunrunFace/selectSunRunStartConfiguration', {status: '00', code: '0', body: {sunrunStartFace: '0', sunrunPointRandom: '0'}}],
  ['/wxxcx/platform/camera/getCameraConfig', {status: '00', code: '0', body: {flag: 0}, data: []}],
  ['/wxxcx/platform/sunrunFace/selectSunRunRandomConfiguration', {status: '00', code: '0', body: {}}],
  ['/wxxcx/platform/sunrunFace/startUpNote', {status: '00', code: '0'}],
  ['/wxxcx/sunrun/getRunBegin', {status: '00', code: '0', scantronId: 'local-scantron'}],
  ['/wxxcx/sunrun/getRunPointList', {status: '00', code: '0', data: []}],
  ['/wxxcx/sunrun/getRunPointListAbnormal', {status: '00', code: '0', data: []}],
  ['/wxxcx/sunrun/sunRunExercises', {status: '00', code: '0'}],
  ['/wxxcx/platform/recrecord/sunRunExercisesDetail', {status: '00', code: '0'}],
]);

export class LabBackend {
  #server;
  #host;
  #port;
  requests = [];

  constructor({host = '127.0.0.1', port = 3210} = {}) {
    if (!['127.0.0.1', '::1'].includes(host)) throw new Error('LAB_BACKEND_MUST_BE_LOOPBACK');
    this.#host = host;
    this.#port = port;
  }

  get url() {
    if (!this.#server?.listening) throw new Error('LAB_BACKEND_NOT_RUNNING');
    const address = this.#server.address();
    return `http://${this.#host === '::1' ? '[::1]' : this.#host}:${address.port}`;
  }

  async start() {
    this.#server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString();
      const auth = request.headers.authorization || '';
      const clean = sanitize({method: request.method, path: request.url, authorization: auth, body: rawBody});
      this.requests.push({...clean.value, credentialPresent: clean.credentialPresent});
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      if (auth !== 'Bearer DEMO_SESSION') {
        response.statusCode = 401;
        response.end(JSON.stringify({code: 401, message: 'synthetic credential required'}));
        return;
      }
      const path = new URL(request.url, this.url).pathname;
      let payload;
      if (path.endsWith('/GetStudentInfoByToken')) payload = {code: '0', obj: {snCode: 'DEMO_STUDENT', schoolCode: 'DEMO_SCHOOL', schoolCampusCode: 'DEMO_CAMPUS', studentName: 'Synthetic User'}};
      else if (path === '/wxxcx/sunrun/getSunrunPaper') payload = {status: '00', code: '0', getSunrunPaperResponseList: [TASK]};
      else payload = replies.get(path);
      if (!payload) { response.statusCode = 404; payload = {code: 404, message: 'contract endpoint not implemented'}; }
      response.end(JSON.stringify(payload));
    });
    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#port, this.#host, resolve);
    });
    return this;
  }

  async close() {
    if (!this.#server) return;
    await new Promise((resolve, reject) => this.#server.close(error => error ? reject(error) : resolve()));
  }
}
