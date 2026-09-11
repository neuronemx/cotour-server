const base = 'https://media.immersalive.com';
const file = (folder, name) => base + '/' + folder + '/' + encodeURIComponent(name);
const raw = [['amc','video','AMC.mp4'],['ia','video','IA.mp4'],['nanana','video','NANANA.mp4'],['one','video','ONE.mp4'],['sea-palms','video','SEA_PALMS.mp4'],['epic-christmas','audio','Epic Christmas.mp3'],['red-carpet','audio','Red Carpet.mp3'],['selfie','audio','Selfie.mp3']];
function listAudiovisualResources() { return raw.map(([id,type,name]) => ({ id, type, name: name.replace(/\.(mp4|mp3)$/i,''), media_url:file(type,name), thumbnail_url:type==='video'?file('thumbs',name.replace(/\.mp4$/i,'.jpg')):'', owner_type:'immersa' })); }
module.exports = { listAudiovisualResources };
