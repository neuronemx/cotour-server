const { io } = require('socket.io-client');

const target = (process.env.IMMERSA_TEMP_URL || '').replace(/\/$/, '');
const publicId = process.env.IMMERSA_EVENT_PUBLIC_ID || '';
const liveId = process.env.IMMERSA_LIVE_SESSION_ID || '';
const users = Math.min(Math.max(+process.env.USERS || 1, 1), 2500);
const ramp = Math.max(+process.env.RAMP_MS || 0, 0);
const hold = Math.max(+process.env.HOLD_MS || 300000, 1000);
const triviaStartWait = Math.max(+process.env.TRIVIA_START_WAIT_MS || hold, 1000);
const stats = { http: 0, httpErrors: 0, userErrors: 0, socketErrors: 0, connected: 0, joinedAudience: 0, triviaJoined: 0, answers: 0, answersQuestion1: 0, answersQuestion2: 0, rejected: 0, advancedToNextQuestion: 0, disconnected: 0 };

if (!target || !publicId || !liveId) throw Error('Required: IMMERSA_TEMP_URL, IMMERSA_EVENT_PUBLIC_ID, IMMERSA_LIVE_SESSION_ID');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options = {}) {
  stats.http++;
  let response;
  try {
    response = await fetch(target + path, options);
  } catch (error) {
    stats.httpErrors++;
    throw error;
  }
  if (!response.ok) {
    stats.httpErrors++;
    throw Error('HTTP ' + response.status);
  }
  return response.json();
}

function wait(socket, events, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout ' + events.join(','))), timeout);
    for (const event of events) {
      const handler = (payload) => {
        if (event === 'interaction:execution:state' && payload?.category !== 'contest') return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve([event, payload]);
      };
      socket.on(event, handler);
    }
  });
}

// Prepared Trivia has no currentQuestion; wait specifically for the operator's start event.
function waitForQuestion(socket, { afterQuestionId = "", timeout } = {}) {
  return new Promise((resolve, reject) => {
    const onState = (state) => {
      const question = state?.category === 'contest' ? state.currentQuestion : null;
      if (!question?.id || !question.options?.[0]?.id || question.id === afterQuestionId) return;
      clearTimeout(timer);
      socket.off('interaction:execution:state', onState);
      resolve(question);
    };
    const timer = setTimeout(() => {
      socket.off('interaction:execution:state', onState);
      reject(Error(afterQuestionId ? 'Trivia did not advance to the next question before the configured wait expired' : 'Trivia did not start before the configured wait expired'));
    }, timeout);
    socket.on('interaction:execution:state', onState);
  });
}

async function submitAnswer(socket, question, { number, tabId, attempt }) {
  const reply = wait(socket, ['interaction:answer:accepted', 'interaction:knowledge:rejected'], 30000);
  socket.emit('interaction:participant:submit_answer', {
    questionId: question.id,
    optionId: question.options[number % question.options.length].id,
    tabId,
    clientAttemptId: 'load-' + number + '-' + attempt
  });
  return reply;
}

async function user(number) {
  let socket;
  try {
    const registration = await request('/api/event/public/' + encodeURIComponent(publicId) + '/registration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registrationKey: 'github-trivia-' + process.env.GITHUB_RUN_ID + '-' + number })
    });
    const entry = await request('/api/event/live-sessions/' + encodeURIComponent(liveId) + '/enter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantId: registration.participantId })
    });
    const html = await fetch(target + entry.audiencePath).then((response) => response.text());
    const session = html.match(/session":"([^"]+)/)?.[1];
    const deck = html.match(/deck":"([^"]+)/)?.[1];
    if (!session || !deck) throw Error('audience bootstrap missing');

    socket = io(target, { transports: ['websocket', 'polling'], reconnection: false, timeout: 30000 });
    socket.on('connect_error', () => stats.socketErrors++);
    socket.on('disconnect', () => stats.disconnected++);
    await wait(socket, ['connect'], 30000);
    stats.connected++;
    const connectedAt = Date.now();
    socket.emit('join_presentation', { session, deck, role: 'audience', audienceId: registration.participantId, audienceName: 'load-' + number, label: 'github-trivia' });
    stats.joinedAudience++;

    await wait(socket, ['interaction:execution:state'], triviaStartWait);
    const tabId = 'load-tab-' + number;
    socket.emit('interaction:participant:join', { name: 'load-' + number, tabId });
    await wait(socket, ['interaction:participant:joined'], 30000);
    stats.triviaJoined++;

    const question1 = await waitForQuestion(socket, { timeout: triviaStartWait });
    const [firstEvent] = await submitAnswer(socket, question1, { number, tabId, attempt: 'q1' });
    if (firstEvent === 'interaction:answer:accepted') {
      stats.answers++;
      stats.answersQuestion1++;
    } else {
      stats.rejected++;
    }

    const question2 = await waitForQuestion(socket, { afterQuestionId: question1.id, timeout: triviaStartWait });
    stats.advancedToNextQuestion++;
    const [secondEvent] = await submitAnswer(socket, question2, { number, tabId, attempt: 'q2' });
    if (secondEvent === 'interaction:answer:accepted') {
      stats.answers++;
      stats.answersQuestion2++;
    } else {
      stats.rejected++;
    }

    await sleep(Math.max(0, connectedAt + hold - Date.now()));
  } catch (error) {
    stats.userErrors++;
    console.error('[user ' + number + '] ' + error.message);
  } finally {
    socket?.disconnect();
  }
}

(async () => {
  console.log(JSON.stringify({ users, ramp, hold, triviaStartWait }));
  await Promise.all(Array.from({ length: users }, (_, index) => (async () => {
    if (index) await sleep(index * ramp);
    await user(index + 1);
  })()));
  console.log(JSON.stringify(stats, null, 2));
})();
