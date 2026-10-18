const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { EventAccessError } = require('./authorization');
const { EventDeckPrivateStore, digest } = require('./deck-private-store');
const exec = promisify(execFile);
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const fail = () => { throw new EventAccessError('MEDIA_INTEGRITY_FAILED', 409); };
const invalid = () => { throw new EventAccessError('INVALID_MEDIA', 400); };
function webmHeader(bytes) {
  function vint(offset, id = false) {
    const first = bytes[offset]; if (!first) invalid();
    let n = 1; while (n <= 8 && !(first & (1 << (8 - n)))) n++;
    if (n > (id ? 4 : 8) || offset + n > bytes.length) invalid();
    let value = BigInt(id ? first : first & ((1 << (8 - n)) - 1));
    for (let i = 1; i < n; i++) value = value * 256n + BigInt(bytes[offset + i]);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(); return { n, value: Number(value) };
  }
  const length = vint(4), end = 4 + length.n + length.value;
  if (end > Math.min(bytes.length,4096)) invalid();
  let at = 4 + length.n, found = false;
  while (at < end) {
    const id = vint(at,true); at += id.n; const size = vint(at); at += size.n;
    if (at + size.value > end) invalid();
    if (id.value === 0x4282) { if (found || bytes.subarray(at,at+size.value).toString() !== 'webm') invalid(); found = true; }
    at += size.value;
  }
  if (!found) invalid();
}
function container(bytes) {
  if (bytes.length < 12) invalid();
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WAVE') return 'wav';
  if (bytes.subarray(4,8).toString() === 'ftyp') return 'mov';
  if (bytes.subarray(0,4).toString('hex') === '1a45dfa3') { webmHeader(bytes); return 'matroska'; }
  if (bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return 'mp3';
  invalid();
}
async function probeMedia(file, expected) {
  let stdout;
  try {
    ({ stdout } = await exec('ffprobe', ['-v','error','-protocol_whitelist','file','-format_whitelist',expected,
      ...(expected === 'mov' ? ['-enable_drefs','0','-use_absolute_path','0'] : []),
      '-show_entries','format=format_name,duration:stream=codec_type,codec_name,width,height:stream_tags=alpha_mode',
      '-of','json',file], { timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true }));
  } catch (e) {
    if (e.code === 'ENOENT') throw new EventAccessError('MEDIA_TOOLS_UNAVAILABLE', 503);
    invalid();
  }
  let body; try { body = JSON.parse(stdout); } catch (_) { invalid(); }
  const streams = body.streams;
  if (!Array.isArray(streams) || !streams.length || streams.length > 2 || !body.format?.format_name?.split(',').includes(expected)) invalid();
  const videos = streams.filter(s => s.codec_type === 'video'), audios = streams.filter(s => s.codec_type === 'audio');
  if (videos.length > 1 || audios.length > 1 || videos.length + audios.length !== streams.length) invalid();
  const type = videos.length ? 'video' : 'audio', video = videos[0], audio = audios[0];
  const allowed = { wav: { audio: ['pcm_s16le'], video: [] }, mp3: { audio: ['mp3'], video: [] },
    mov: { audio: ['aac'], video: ['h264'] }, matroska: { audio: ['opus','vorbis'], video: ['vp8','vp9'] } }[expected];
  if ((video && !allowed.video.includes(video.codec_name)) || (audio && !allowed.audio.includes(audio.codec_name))
    || (expected === 'matroska' && !video)) invalid();
  const duration = Number(Number(body.format.duration).toFixed(6));
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) invalid();
  if (video && (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height)
    || video.width < 1 || video.height < 1 || video.width > 16384 || video.height > 16384)) invalid();
  const contentType = expected === 'mov' ? type === 'video' ? 'video/mp4' : 'audio/mp4'
    : expected === 'matroska' ? 'video/webm' : expected === 'wav' ? 'audio/wav' : 'audio/mpeg';
  return { type, contentType, duration, width: video?.width || null, height: video?.height || null,
    videoCodec: video?.codec_name || null, audioCodec: audio?.codec_name || null, alphaMetadata: video?.tags?.alpha_mode === '1' };
}
class EventMediaPrivateStore extends EventDeckPrivateStore {
  constructor(options) { super(options); this.probe = options.probe || probeMedia; this.maxBytes = MAX_MEDIA_BYTES; }
  directory(scope) { return super.directory({ ...scope, attemptId: scope.id }); }
  async verified(row) {
    let handle;
    try {
      const file = path.join(this.directory(row), 'media.bin');
      await this.directories(path.dirname(file));
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== row.size || before.size < 1 || before.size > this.maxBytes) fail();
      const hash = crypto.createHash('sha256');
      for await (const chunk of handle.createReadStream({ start: 0, end: before.size - 1, autoClose: false })) hash.update(chunk);
      const after = await handle.stat();
      if (hash.digest('hex') !== row.sha256 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail();
      const verified = handle; handle = null; return verified;
    } catch (e) { if (e instanceof EventAccessError) throw e; fail(); }
    finally { await handle?.close(); }
  }
  async prepare(scope, bytes) {
    const expected = container(bytes), dir = this.directory(scope);
    await this.directories(path.dirname(dir), true); await fs.mkdir(dir, { mode: 0o700 });
    const file = path.join(dir, 'media.bin');
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o400 });
    const info = await this.probe(file, expected);
    const handle = await this.verified({ ...scope, size: bytes.length, sha256: digest(bytes) }); await handle.close();
    return info;
  }
}
module.exports = { EventMediaPrivateStore, MAX_MEDIA_BYTES, probeMedia, container };
