const test = require("node:test");
const assert = require("node:assert/strict");
const { formatDataDate, dataTimeZone } = require("../data-time");
const { estimateDemoBrandImpressions } = require("../scripts/estimate-demo-brand-impressions");

test("Data treats timezone-less database timestamps as UTC and formats named regions without fixed offsets", () => {
  for(const input of [new Date("2026-11-10T16:53:00Z"),"2026-11-10T16:53:00.000Z","2026-11-10 16:53:00"]) {
    assert.equal(formatDataDate(input,"America/Mexico_City"),"2026-11-10 10:53:00");
  }
  assert.equal(formatDataDate("2026-07-10T16:53:00Z","Europe/Madrid"),"2026-07-10 18:53:00");
  assert.equal(formatDataDate("2026-11-10T16:53:00Z","Europe/Madrid"),"2026-11-10 17:53:00");
  assert.equal(formatDataDate(null),"");
  assert.throws(()=>dataTimeZone("invalid-region"),{statusCode:400});
});

test("Demo impressions use attendee-minutes, not the peak multiplied by duration or the number of brands", async () => {
  const writes=[];
  const pool={async execute(sql,params){
    if(sql.startsWith("SELECT id FROM schema_migrations")) return [[]];
    if(sql.includes("SELECT s.details")) return [[{attendees:73,audience_peak_count:60,details:{brandCount:3,durationSeconds:1080}}]];
    writes.push({sql,params});return [{affectedRows:1}];
  }};
  await estimateDemoBrandImpressions(pool,{RAILWAY_ENVIRONMENT_ID:"production"});
  assert.equal(writes.length,0);
  await estimateDemoBrandImpressions(pool,{RAILWAY_ENVIRONMENT_ID:"9ae7d5ba-2954-4c96-818a-ee918310e20d"});
  const saved=JSON.parse(writes[0].params[0]);
  assert.equal(saved.brandEstimate.calculatedImpressions,328.5);
  assert.equal(saved.brandEstimate.globalImpressions,330);
  assert.equal(saved.brandEstimate.averageConnectedMinutes,9);
  assert.equal(saved.brandCount,3);
});

test("All eight workbook sheets use the requested region for dates, including Q&A, and retain IDs and answers verbatim", async () => {
  const {PassThrough}=require("node:stream");
  const ExcelJS=require("exceljs");
  const {writeSessionWorkbook}=require("../session-export");
  const utc="2026-11-10T16:53:00.000Z";
  const summary={id:"session",deckId:"deck",startedAt:utc,endedAt:utc,recordedSince:utc,
    participants:{connected:1,peak:1},participation:{active:1,percentage:100},
    qna:{received:1,projected:1},polls:[],reactions:{total:1},knowledge:[],raffles:{total:1,entries:1,winners:1},brands:[]};
  const repository={
    engagement:{async details(){return {total:1,attendees:[{id:"person",name:"Ana",actions:1,joinedAt:new Date(utc),termsAcceptedAt:utc,
      answers:[{type:"poll",question:"Fecha?",answer:utc,at:utc}],
      questions:[{text:"¿Cuándo?",at:new Date(utc),projectedAt:"2026-11-10 16:53:00"}],reactions:{byEmoji:{"❤️":1},total:1}}]};}},
    async raffles(){return [{entries:[{audienceId:"person",enteredAt:utc}],winners:[{audienceId:"person",selectedAt:utc}]}];},
    pool:{async execute(){return [[{id:"person",at:new Date(utc),kind:"clic"}]];}}
  };
  const stream=new PassThrough(),chunks=[];
  stream.on("data",c=>chunks.push(c));
  await writeSessionWorkbook(repository,summary,stream,{timeZone:"America/Mexico_City"});
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.concat(chunks));
  for(const [sheet,cell] of [["Resumen","D3"],["Asistentes","I2"],["Asistentes","P2"],["Respuestas","I2"],["Preguntas","E2"],["Preguntas","F2"],["Sorteos","J2"],["Sorteos","L2"],["Actividad de marcas","H2"]]) {
    assert.equal(book.getWorksheet(sheet).getCell(cell).value,"2026-11-10 10:53:00",sheet+" "+cell);
  }
  assert.equal(book.getWorksheet("Respuestas").getCell("G2").value,utc);
  assert.equal(book.getWorksheet("Resumen").getCell("D2").value,"America/Mexico_City");
});
