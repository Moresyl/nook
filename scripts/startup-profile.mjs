export const startStartupProfileExpression = `(async () => {
  const session = new (require('node:inspector').Session)();
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  try {
    session.connect();
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 10000 });
    await post('Profiler.start');
    globalThis.qiyaoCaptureStartupProfile = async () => {
      delete globalThis.qiyaoCaptureStartupProfile;
      try { return (await post('Profiler.stop')).profile; }
      finally { session.disconnect(); }
    };
    return true;
  } catch { session.disconnect(); return false; }
})()`;

export function summarizeStartupProfile(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) return undefined;
  const names = new Map(profile.nodes.map(node => [node.id, String(node.callFrame?.functionName || '(anonymous)').replace(/[\r\n\t]/g, ' ').slice(0, 100)]));
  const frames = new Map();
  profile.samples.forEach((id, index) => {
    const name = names.get(id) ?? '(unknown)';
    const frame = frames.get(name) ?? { name, samples: 0, microseconds: 0 };
    frame.samples++;
    const delta = profile.timeDeltas?.[index];
    if (Number.isFinite(delta) && delta >= 0) frame.microseconds += delta;
    frames.set(name, frame);
  });
  return {
    durationMs: Math.max(0, (profile.endTime - profile.startTime) / 1000),
    samples: profile.samples.length,
    frames: [...frames.values()].sort((a, b) => b.microseconds - a.microseconds || b.samples - a.samples).slice(0, 12),
  };
}
