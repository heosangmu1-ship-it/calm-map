// YAMNet on the tfjs WASM backend, off the main thread (docs/STRUCTURE.md "Model off the main thread").
// main -> worker: {type:'init', modelBase, wasmBase} | {type:'win', win:Float32Array}
// worker -> main: {type:'stage', stage} | {type:'progress', p} | {type:'ready'} | {type:'scores', scores, infMs} | {type:'error', msg}
importScripts('../vendor/tf.min.js', '../vendor/tf-backend-wasm.min.js');

const WINDOW = 15600;
let model;
const t0 = performance.now();
const step = (stage) => {
  console.info(`[model] ${stage} +${Math.round(performance.now() - t0)}ms`);
  postMessage({ type: 'stage', stage });
};

async function init({ modelBase, wasmBase }) {
  step('backend');
  tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false); // GitHub Pages cannot send COOP/COEP; only the non-threaded builds are vendored
  tf.wasm.setWasmPaths(wasmBase);
  let ok = false;
  try {
    ok = await tf.setBackend('wasm');
  } catch {}
  if (!ok || tf.getBackend() !== 'wasm') await tf.setBackend('cpu');
  await tf.ready();
  console.info('[model] backend', tf.getBackend());
  step('weights');
  const m = await tf.loadGraphModel(modelBase + 'model.json', { onProgress: (p) => p < 1 && postMessage({ type: 'progress', p }) });
  step('warmup'); // first executeAsync: no shader compile on wasm, kept so the first real window is not slow
  const z = tf.zeros([WINDOW]);
  const o = await m.executeAsync(z);
  [z, ...(Array.isArray(o) ? o : [o])].forEach((t) => t.dispose());
  model = m;
  step('ready');
  postMessage({ type: 'ready' });
}

async function infer(win) {
  const input = tf.tensor1d(win);
  const t1 = performance.now();
  const out = await model.executeAsync(input);
  const outs = Array.isArray(out) ? out : [out];
  const t = outs.find((x) => x.shape.length === 2 && x.shape[1] === 521);
  if (!t) throw new Error('no 521-class output');
  const scores = new Float32Array(await t.mean(0).data()); // own buffer, safe to transfer
  const infMs = performance.now() - t1;
  [input, ...outs].forEach((x) => x.dispose());
  postMessage({ type: 'scores', scores, infMs }, [scores.buffer]);
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') await init(data);
    else if (data.type === 'win') await infer(data.win);
  } catch (e) {
    postMessage({ type: 'error', msg: String((e && e.message) || e) });
  }
};
