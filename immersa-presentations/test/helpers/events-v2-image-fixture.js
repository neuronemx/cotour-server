const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const exec=require('node:util').promisify(require('node:child_process').execFile);
async function imageFixture(kind='png',size='16x16'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'event-image-fixture-'));
 try{
  const file=path.join(dir,'fixture.'+kind),codec={png:'png',jpg:'mjpeg',webp:'libwebp'}[kind];
  await exec('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=blue@0.25:s=${size},format=rgba`,'-frames:v','1','-threads','1','-c:v',codec,'-y',file],{timeout:15000,maxBuffer:65536});
  return await fs.readFile(file);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={imageFixture};
