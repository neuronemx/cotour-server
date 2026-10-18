const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {promisify}=require('node:util');
const exec=promisify(require('node:child_process').execFile);
function wavFixture(){
  const bytes=Buffer.alloc(44+1600);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(1600,40);return bytes;
}
async function mediaFixture(kind='webm'){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'events-media-fixture-'));
  try{
    const file=path.join(dir,'fixture.'+kind),video=['mp4','webm','mkv'].includes(kind);
    const args=video?['-f','lavfi','-i','color=c=red@0.25:s=16x16:r=10,format=yuva420p']:['-f','lavfi','-i','sine=frequency=440:sample_rate=8000'];
    const encoder=kind==='webm'||kind==='mkv'?['-c:v','libvpx-vp9','-auto-alt-ref','0','-pix_fmt','yuva420p']:kind==='mp4'?['-c:v','libx264','-pix_fmt','yuv420p']:kind==='mp3'?['-c:a','libmp3lame']:['-c:a','aac'];
    await exec('ffmpeg',['-v','error',...args,'-t','0.3',...encoder,'-threads','1','-y',file],{timeout:15000,maxBuffer:65536});
    return await fs.readFile(file);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={wavFixture,mediaFixture};
