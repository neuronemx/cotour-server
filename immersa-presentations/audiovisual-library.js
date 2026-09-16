const base = 'https://media.immersalive.com';
// Increment this when a media file is replaced under the same filename.
const mediaRevision = '20260916-1';
const file = (folder, name) => base + '/' + folder + '/' + encodeURIComponent(name) + '?v=' + mediaRevision;
const raw = [
  ['amc','video','AMC.mp4'],
  ['ia','video','IA.mp4'],
  ['nanana','video','NANANA.mp4'],
  ['one','video','ONE.mp4'],
  ['sea-palms','video','SEA_PALMS.mp4'],
  ['evento-1','video','Evento_1.mp4'],
  ['loop-1','video','Loop1.mp4'],
  ['loop-2','video','Loop2.mp4'],
  ['mexico','video','MEXICO.mp4'],
  ['night-city-skyline','video','Night_City_Skyline.mp4'],
  ['zen','video','Zen.mp4'],
  ['epic-christmas','audio','Epic Christmas.mp3'],
  ['red-carpet','audio','Red Carpet.mp3'],
  ['selfie','audio','Selfie.mp3'],
  ['champions','audio','Champions.mp3'],
  ['chillout','audio','Chillout.mp3']
];
function listAudiovisualResources() { return raw.map(([id,type,name]) => ({ id, type, name: name.replace(/\.(mp4|mp3)$/i,''), media_url:file(type,name), thumbnail_url:type==='video'?file('thumbs',name.replace(/\.mp4$/i,'.jpg')):'', owner_type:'immersa' })); }
module.exports = { listAudiovisualResources };
