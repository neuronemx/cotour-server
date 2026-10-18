const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { EventAccessError } = require('./authorization');
const { EventMediaPrivateStore } = require('./media-private-store');
const { digest } = require('./deck-private-store');
const exec = promisify(execFile);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const invalid = () => { throw new EventAccessError('INVALID_IMAGE',400); };
function imageFormat(bytes) {
  if (bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a') {
    let at=8,ended=false;
    while(at+12<=bytes.length){
      const size=bytes.readUInt32BE(at),type=bytes.subarray(at+4,at+8).toString();
      if(at+12+size>bytes.length || type==='acTL') invalid();
      at+=12+size;
      if(type==='IEND'){ended=true;break;}
    }
    if(!ended || at!==bytes.length) invalid();
    return 'png_pipe';
  }
  if (bytes.subarray(0,3).toString('hex') === 'ffd8ff') return 'jpeg_pipe';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') {
    if(bytes.readUInt32LE(4)+8!==bytes.length) invalid();
    let at=12;
    while(at+8<=bytes.length){
      const type=bytes.subarray(at,at+4).toString(),size=bytes.readUInt32LE(at+4);
      if(at+8+size>bytes.length || ['ANIM','ANMF'].includes(type)) invalid();
      at+=8+size+(size%2);
    }
    if(at!==bytes.length) invalid();
    return 'webp_pipe';
  }
  invalid();
}
async function probeImage(file,format) {
  const contentType = {png_pipe:'image/png',jpeg_pipe:'image/jpeg',webp_pipe:'image/webp'}[format];
  const codec = {png_pipe:'png',jpeg_pipe:'mjpeg',webp_pipe:'webp'}[format];
  if (!contentType) invalid();
  try {
    const {stdout} = await exec('ffprobe',['-v','error','-protocol_whitelist','file','-format_whitelist',format,
      '-show_entries','stream=codec_type,codec_name,width,height','-of','json',file],{timeout:10000,maxBuffer:65536,windowsHide:true});
    const streams=JSON.parse(stdout).streams;
    if (!Array.isArray(streams) || streams.length !== 1) invalid();
    const s=streams[0];
    if (s.codec_type !== 'video' || s.codec_name !== codec || !Number.isSafeInteger(s.width) || !Number.isSafeInteger(s.height)
      || s.width < 1 || s.height < 1 || s.width > 4096 || s.height > 4096) invalid();
    // Decode the complete raster before it can be referenced. A second frame
    // rejects image sequences; SVG, playlists and external protocols are absent.
    const decoded=await exec('ffmpeg',['-v','error','-nostdin','-xerror','-err_detect','explode','-max_alloc','134217728',
      '-threads','1','-protocol_whitelist','file','-format_whitelist',format,'-f',format,'-i',file,
      '-map','0:v:0','-frames:v','2','-threads','1','-progress','pipe:1','-f','null','-'],{timeout:15000,maxBuffer:65536,windowsHide:true});
    const frames=[...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map(m=>Number(m[1]));
    if (!frames.length || frames.at(-1) !== 1) invalid();
    return {type:'image',contentType,width:s.width,height:s.height};
  } catch(e) {
    if (e instanceof EventAccessError) throw e;
    if (e.code === 'ENOENT') throw new EventAccessError('IMAGE_TOOLS_UNAVAILABLE',503);
    invalid();
  }
}
class EventImagePrivateStore extends EventMediaPrivateStore {
  constructor(options) { super(options); this.maxBytes=MAX_IMAGE_BYTES; }
  async verified(row) {
    try { return await super.verified(row); }
    catch(e) { if(e.code==='MEDIA_INTEGRITY_FAILED') throw new EventAccessError('IMAGE_INTEGRITY_FAILED',409); throw e; }
  }
  async prepare(scope,bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) throw new EventAccessError('INVALID_IMAGE_SIZE',413);
    const format=imageFormat(bytes),dir=this.directory(scope);
    await this.directories(path.dirname(dir),true); await fs.mkdir(dir,{mode:0o700});
    const file=path.join(dir,'media.bin');
    await fs.writeFile(file,bytes,{flag:'wx',mode:0o400});
    const info=await probeImage(file,format);
    const handle=await this.verified({...scope,size:bytes.length,sha256:digest(bytes)});await handle.close();
    return info;
  }
}
module.exports={EventImagePrivateStore,MAX_IMAGE_BYTES,imageFormat,probeImage};
