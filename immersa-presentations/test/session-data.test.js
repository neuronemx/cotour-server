const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const ExcelJS = require("exceljs");
const { writeSessionWorkbook } = require("../session-export");
const { SessionDataRepository } = require("../session-data");

test("Session Excel exports every attendee page into eight linked sheets and preserves user text as text", async () => {
  const pages = [];
  const summary = { id:"session",deckId:"deck",participants:{connected:1001,peak:500},participation:{active:1,percentage:0},
    polls:[],qna:{received:1,projected:0},reactions:{total:1},knowledge:[],raffles:{total:1,entries:1,winners:1},brands:[] };
  const repository = {
    pool:{async execute(){return [[]];}},
    async raffles(){return [{executionId:"raffle",title:"Premio",state:"closed",entries:[{audienceId:"p1000",name:"Ana",ticketNumber:1}],winners:[{audienceId:"p1000"}]}];},
    engagement:{async details(deck, session, {page}) {
      pages.push(page);
      assert.equal(deck,"deck"); assert.equal(session,"session");
      return {total:1001,attendees:Array.from({length:page===10?1:100},(_,i)=>({
        id:"p"+(page*100+i),name:"=1+1",actions:1,answers:[{type:"poll",title:"Prueba",question:"¿Sí?",answer:"Sí"}],
        questions:[{text:"¿Qué?",at:"2026-11-13"}],reactions:{total:1,byEmoji:{"❤️":1}}
      }))};
    }}
  };
  const stream=new PassThrough(), chunks=[];
  stream.on("data", chunk=>chunks.push(chunk));
  await writeSessionWorkbook(repository,summary,stream);
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.concat(chunks));
  assert.equal(book.worksheets.length,8);
  assert.equal(book.getWorksheet("Asistentes").rowCount,1002);
  assert.equal(book.getWorksheet("Respuestas").rowCount,1002);
  assert.deepEqual(pages,[0,1,2,3,4,5,6,7,8,9,10]);
  assert.equal(book.getWorksheet("Asistentes").getCell("D2").value,"=1+1");
  assert.equal(book.getWorksheet("Sorteos").getCell("F2").value,"p1000");
  assert.equal(book.getWorksheet("Sorteos").getCell("K2").value,true);
});

test("A raffle snapshot arriving during a write is drained before finish and a failed write can retry",async()=>{
  let repository, calls=0, fail=true;
  repository=new SessionDataRepository({async execute(){
    calls++;
    if(fail) throw Error("retry");
    if(calls===2) repository.captureRaffle({presentationSessionId:"session"}, {id:"same",createdAt:"date",entries:[{audienceId:"new"}]});
  }},{async activeLiveSession(){return "session";}},null);
  repository.captureRaffle({presentationSessionId:"session"}, {id:"same",createdAt:"date",entries:[]});
  await assert.rejects(repository.flushRaffles());
  fail=false;
  await repository.flushRaffles();
  assert.equal(calls,3);
  assert.equal(repository.rafflePending.size,0);
});

test("Repeated draws keep every confirmed winner through close", () => {
  const repository = new SessionDataRepository({}, {}, {});
  const context = {sessionId:"live",deckId:"deck"};
  const raffle = {id:"raffle",createdAt:"start",entries:[]};
  repository.captureRaffle(context,{...raffle,winner:{audienceId:"a"},winnerSelectedAt:"first"});
  repository.captureRaffle(context,{...raffle,winner:{audienceId:"b"},winnerSelectedAt:"second"});
  repository.captureRaffle(context,{...raffle,state:"closed",winner:null});
  const saved = [...repository.rafflePending.values()][0].snapshot;
  assert.deepEqual(saved.winners.map(w=>w.audienceId),["a","b"]);
  repository.releaseSession(context);
  assert.equal(repository.raffleWinners.size,0);
});
