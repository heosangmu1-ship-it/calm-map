// On-device sound classification: mic -> 16 kHz mono -> YAMNet (TF.js WASM in a Web Worker) -> group + loudness.
// Audio lives only in memory (a ~2 s ring of floats); nothing is stored or sent.
import { decide, chimeScore } from './groups.js';

export const RATE = 16000;
export const WINDOW = 15600; // one YAMNet frame, 0.975 s
export const HOP = 8000; // 0.5 s
const HISTORY = 4; // windows averaged = last ~2 s

/**
 * Streaming resampler to 16 kHz mono. Boxcar average when downsampling (cheap anti-alias),
 * linear interpolation when upsampling. Keeps fractional position across chunks.
 * @param {number} srcRate input sample rate
 * @returns {(chunk: Float32Array) => Float32Array}
 */
export function createResampler(srcRate) {
  if (srcRate === RATE) return (c) => c;
  const ratio = srcRate / RATE;
  let rest = new Float32Array(0);
  let pos = 0;
  return (chunk) => {
    const buf = new Float32Array(rest.length + chunk.length);
    buf.set(rest);
    buf.set(chunk, rest.length);
    const out = [];
    if (ratio >= 1) {
      while (pos + ratio <= buf.length) {
        const a = Math.floor(pos);
        const b = Math.min(buf.length, Math.ceil(pos + ratio));
        let s = 0;
        for (let i = a; i < b; i++) s += buf[i];
        out.push(s / (b - a));
        pos += ratio;
      }
    } else {
      while (pos + 1 < buf.length) {
        const i = Math.floor(pos);
        const f = pos - i;
        out.push(buf[i] * (1 - f) + buf[i + 1] * f);
        pos += ratio;
      }
    }
    const drop = Math.floor(pos);
    rest = buf.slice(drop);
    pos -= drop;
    return Float32Array.from(out);
  };
}

/** Mean-square -> dBFS, floored at -100. */
export function toDb(meanSquare) {
  return Math.max(-100, 10 * Math.log10(meanSquare + 1e-10));
}

// Phone mics with AGC off deliver -50..-65 dBFS speech/traffic; YAMNet's log-mel has a fixed offset, so such
// input reads as class "Silence". Raise quiet windows to NORM_TARGET_DB; below NORM_FLOOR_DB it is a really quiet room: leave it.
// Measured: docs/QUIET-BUG.md. Floor/target are not tuned on real phone data.
export const NORM_TARGET_DB = -30;
export const NORM_FLOOR_DB = -68;

/** Software gain for the model input only (never attenuates, clamps to [-1,1]). @param {Float32Array} win @returns {Float32Array} */
export function normalise(win) {
  let ms = 0;
  for (let i = 0; i < win.length; i++) ms += win[i] * win[i];
  const db = toDb(ms / win.length);
  if (db < NORM_FLOOR_DB || db >= NORM_TARGET_DB) return win;
  const k = 10 ** ((NORM_TARGET_DB - db) / 20);
  return win.map((v) => Math.max(-1, Math.min(1, v * k)));
}

// chime flag: strongest Chime/Doorbell/Ding-dong class in the last window above this score. Not tuned on real data.
const CHIME_MIN = 0.3;
const SILENCE = 494; // YAMNet class "Silence", reported for diagnostics

const MODEL_GUARD_MS = 45000; // model load longer than this is shown as an error (the load itself keeps going)

const MSG = {
  denied: '마이크 권한이 거부됐어요. 브라우저 설정에서 허용하거나 샘플 소리로 체험해 보세요.',
  nomic: '사용할 수 있는 마이크가 없어요. 샘플 소리로 체험해 보세요.',
  insecure: '이 주소에서는 마이크를 쓸 수 없어요 (HTTPS 필요). 샘플 소리로 체험해 보세요.',
  model: '소리 분석 모델을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.',
  modelStage: (stage) => `소리 분석 모델을 불러오지 못했어요 (단계: ${stage})`,
  other: '마이크를 시작하지 못했어요.',
};

/**
 * @param {{onFrame:Function, onError?:Function, onProgress?:Function, modelBase?:string}} opts
 * onFrame({ts, db, group, groupScores, topClass, topScore, top5, chime}) about every 0.5 s; db = RMS dBFS of last window (uncalibrated).
 * onAnalyser(AnalyserNode|null): mic mode, the analyser on the same source (null on stop). onLevel(db): RMS dBFS of each mic/sample chunk. Both work without the model.
 * Mic mode: the stream path starts at once and the model loads in parallel; a model failure calls onError(msg, {retry:true}) once, the mic stays on, retryModel() retries.
 * onStage('script'|'backend'|'weights'|'warmup'): model load step (backend..warmup run in the worker); onProgress(p): weights fraction, 1 = model ready.
 */
export function createListener({ onFrame, onError = () => {}, onProgress = () => {}, onStage = () => {}, onAnalyser = () => {}, onLevel = () => {}, modelBase } = {}) {
  const base = modelBase ?? new URL('../model/yamnet/', import.meta.url).href;
  let worker = null; // survives stop(): the model stays loaded
  let ready = false;
  let loading = null; // {res, rej} while the worker initialises
  let inflight = null; // {mine, ms} of the window the worker is scoring
  let names = null;
  let ctx = null;
  let stream = null;
  let node = null;
  let timer = null;
  let resample = null;
  let ring = new Float32Array(0);
  let fresh = 0; // samples since last inference
  let busy = false;
  let history = []; // {scores:Float32Array, ms:number}
  let session = 0;
  let modelP = null;
  let stage = '';
  let guard = 0;

  const ensureModel = () => (modelP ??= loadModel().catch((e) => ((modelP = null), Promise.reject(e))));

  async function loadModel() {
    onProgress(0);
    stage = 'script';
    onStage(stage);
    names = await (await fetch(new URL('../data/yamnet_class_map.json', import.meta.url))).json();
    worker?.terminate();
    ready = busy = false;
    inflight = null;
    const w = (worker = new Worker(new URL('./model-worker.js', import.meta.url)));
    const fail = (msg) => (loading ? loading.rej(new Error(msg)) : w === worker && failWindow(msg));
    w.onmessage = ({ data: d }) => {
      if (w !== worker) return;
      if (d.type === 'stage') onStage((stage = d.stage));
      else if (d.type === 'progress') onProgress(d.p);
      else if (d.type === 'ready') loading.res();
      else if (d.type === 'scores') scored(d);
      else fail(d.msg);
    };
    w.onerror = (e) => fail(e.message || 'worker');
    await new Promise((res, rej) => {
      loading = { res, rej };
      w.postMessage({ type: 'init', modelBase: base, wasmBase: new URL('../vendor/', import.meta.url).href });
    }).finally(() => (loading = null));
    ready = true;
    onProgress(1);
  }

  /** Mic mode: load the model without blocking the stream; error once (load failure or guard timeout), the load continues. */
  function loadInBackground() {
    const mine = session;
    let failed = false;
    const fail = () => {
      if (failed || mine !== session) return;
      failed = true;
      onError(MSG.modelStage(stage), { retry: true });
    };
    clearTimeout(guard);
    guard = setTimeout(fail, MODEL_GUARD_MS);
    ensureModel().then(
      () => clearTimeout(guard),
      (e) => (clearTimeout(guard), console.error(e), fail()),
    );
  }

  function infer() {
    busy = true;
    const win = ring.slice(ring.length - WINDOW);
    let ms = 0;
    for (let i = 0; i < win.length; i++) ms += win[i] * win[i];
    inflight = { mine: session, ms: ms / win.length };
    const x = normalise(win); // db stays the original level
    worker.postMessage({ type: 'win', win: x }, [x.buffer]);
  }

  /** Worker reply for the window in flight; a result of an older session is dropped. */
  function scored({ scores, infMs }) {
    const f = inflight;
    inflight = null;
    busy = false;
    if (!f || f.mine !== session) return;
    try {
      history.push({ scores, ms: f.ms, infMs });
      if (history.length > HISTORY) history.shift();
      emit();
    } catch (e) {
      failWindow(e);
    }
  }

  function failWindow(e) {
    console.error(e);
    const mine = inflight?.mine;
    inflight = null;
    busy = false;
    if (mine === undefined || mine === session) {
      stop();
      onError(MSG.model);
    }
  }

  function emit() {
    const n = history.length;
    const { group, groupScores: gs, top5 } = decide(history, names);
    const last = history[n - 1];
    onFrame({
      ts: Date.now(),
      db: toDb(last.ms),
      group,
      groupScores: gs,
      topClass: top5[0].name,
      topScore: top5[0].score,
      top5,
      chime: chimeScore(last.scores) >= CHIME_MIN,
      silence: history.reduce((a, h) => a + h.scores[SILENCE], 0) / n,
      infMs: last.infMs,
      ctxState: ctx?.state,
      sampleRate: ctx?.sampleRate,
    });
  }

  /** Feed device-rate mono samples. Shared by mic and sample mode. */
  function push(chunk) {
    const r = resample(chunk);
    const keep = WINDOW + HOP;
    const merged = new Float32Array(Math.min(keep, ring.length + r.length));
    const all = ring.length + r.length;
    // copy tail of ring + r into merged without allocating the full concat
    const skip = all - merged.length;
    let w = 0;
    for (let i = skip; i < all; i++) merged[w++] = i < ring.length ? ring[i] : r[i - ring.length];
    ring = merged;
    fresh += r.length;
    if (!busy && ready && ring.length >= WINDOW && fresh >= HOP) {
      fresh = 0;
      infer();
    }
  }

  function reset(rate) {
    session++;
    resample = createResampler(rate);
    ring = new Float32Array(0);
    fresh = 0;
    history = [];
  }

  function stop() {
    session++;
    clearTimeout(guard);
    onAnalyser(null);
    clearInterval(timer);
    timer = null;
    if (node) {
      node.onaudioprocess = null;
      node.disconnect();
      node = null;
    }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }

  return {
    async start() {
      stop();
      // create + resume inside the user gesture (iOS Safari)
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const myCtx = ctx;
      try {
        await ctx.resume();
        if (!navigator.mediaDevices?.getUserMedia) {
          stop();
          return onError(window.isSecureContext ? MSG.nomic : MSG.insecure);
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
        } catch (e) {
          stop();
          return onError(e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? MSG.nomic : MSG.denied);
        }
        if (ctx !== myCtx) return; // stopped meanwhile
        reset(ctx.sampleRate);
        const src = ctx.createMediaStreamSource(stream);
        // shortcut: ScriptProcessor is deprecated but works on every browser, upgrade to AudioWorklet if it is removed
        node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
          let ms = 0;
          for (let i = 0; i < chunk.length; i++) ms += chunk[i] * chunk[i];
          onLevel(toDb(ms / chunk.length));
          push(chunk);
        };
        src.connect(node);
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        onAnalyser(an);
        node.connect(ctx.destination); // output stays silent: outputBuffer is never written
        loadInBackground();
      } catch (e) {
        console.error(e);
        stop();
        onError(MSG.other);
      }
    },
    stop,
    retryModel: loadInBackground,
    /** Run a bundled WAV (looped, real-time paced) through the same pipeline. */
    async usingSample(url) {
      stop();
      try {
        await ensureModel();
        const AC = window.AudioContext || window.webkitAudioContext;
        const dec = new AC();
        const buf = await dec.decodeAudioData(await (await fetch(url)).arrayBuffer());
        dec.close().catch(() => {});
        const data = buf.getChannelData(0);
        reset(buf.sampleRate);
        const step = Math.round(buf.sampleRate * 0.1);
        let p = 0;
        timer = setInterval(() => {
          const chunk = data.slice(p, p + step);
          let ms = 0;
          for (let i = 0; i < chunk.length; i++) ms += chunk[i] * chunk[i];
          onLevel(toDb(ms / chunk.length));
          push(chunk);
          p = p + step >= data.length ? 0 : p + step;
        }, 100);
      } catch (e) {
        console.error(e);
        stop();
        onError(MSG.model);
      }
    },
  };
}
