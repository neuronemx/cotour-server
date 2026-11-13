const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {applySessionSupplements} = require("../scripts/apply-session-supplements");
test("The reported reconstruction is restricted to the specified completed Beta session and preserves recorded facts", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"session-supplement-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,"decks","demo-gabriel"),{recursive:true});
  await fs.writeFile(path.join(root,"decks","demo-gabriel","manifest.json"),JSON.stringify({title:"Demo Gabriel"}));
  const writes=[];
  const pool={async execute(sql, params){
    if(sql.includes("SELECT id FROM schema_migrations")) return [[]];
    if(sql.startsWith("SELECT")) {
      assert.match(sql,/RIGHT\(id, 8\) = 'd627d7dc'/);
      assert.match(sql,/ended_at IS NOT NULL/);
      return [[{id:"00000000-0000-0000-0000-0000d627d7dc",deck_id:"demo-gabriel",participant_count:73,audience_peak_count:60}]];
    }
    writes.push({sql,params});return [{affectedRows:1}];
  }};
  await applySessionSupplements(pool,{RAILWAY_ENVIRONMENT_ID:"production"});
  assert.equal(writes.length,0);
  await applySessionSupplements(pool,{RAILWAY_ENVIRONMENT_ID:"9ae7d5ba-2954-4c96-818a-ee918310e20d",IMMERSA_DATA_DIR:root});
  assert.equal(writes.length,2);
  assert.match(writes[0].sql,/INSERT IGNORE INTO presentation_session_supplements/);
  const details=JSON.parse(writes[0].params[1]);
  assert.equal(details.durationSeconds,1080);
  assert.equal(details.raffle.participantsEstimate,60);
  assert.equal(details.raffle.winnerName,"Geraldin Tabullo");
  assert.equal(details.brandCount,3);
  assert.equal(Object.hasOwn(details,"clicks"),false);
  assert.equal(Object.hasOwn(details,"audienceIds"),false);
});

test("Reconstructed Excel labels estimates while retaining the recorded duration and avoids invented attendee and banner events", async () => {
  const {PassThrough}=require("node:stream");
  const ExcelJS=require("exceljs");
  const {writeSessionWorkbook}=require("../session-export");
  const stream=new PassThrough(), chunks=[];
  stream.on("data", chunk=>chunks.push(chunk));
  const summary={
    id:"selected-session",deckId:"demo",durationSeconds:1080,recordedDurationSeconds:2340,
    participants:{connected:73,peak:60},participation:{active:50,percentage:68,estimated:true,minimum:60,maximum:73,percentageMinimum:82,percentageMaximum:100},
    qna:{received:18,projected:1},reactions:{total:2201},polls:[],knowledge:[],
    raffles:{total:1,entries:60,winners:1,estimated:true,winnerName:"Geraldin Tabullo"},brands:[],
    supplement:{brandCount:3,source:"Aportado por organizador",note:"Participación estimada"}
  };
  await writeSessionWorkbook({
    engagement:{async details(){return {attendees:[],total:0};}},
    async raffles(){return [];},pool:{async execute(){return [[]];}}
  },summary,stream);
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.concat(chunks));
  const totals=book.getWorksheet("Resumen");
  const values=new Map();
  totals.eachRow((row,index)=>{if(index>1)values.set(row.getCell(3).value,row.getCell(4).value);});
  assert.equal(values.get("Duración en segundos"),1080);
  assert.equal(values.get("Duración originalmente registrada (s)"),2340);
  assert.equal(values.get("Participación registrada (%)"),68);
  assert.equal(values.get("Participación estimada mínima (%)"),82);
  assert.equal(book.getWorksheet("Asistentes").rowCount,1);
  assert.equal(book.getWorksheet("Sorteos").getCell("G2").value,"Geraldin Tabullo");
  assert.equal(book.getWorksheet("Marcas").getCell("E2").value,null);
  assert.equal(book.getWorksheet("Actividad de marcas").rowCount,1);
});
