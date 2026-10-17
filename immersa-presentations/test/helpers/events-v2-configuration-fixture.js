function configurationFixture(count = 2) {
  return { slides: Array.from({ length: count }, (_, i) => ({ id: 'slide-' + String(i + 1).padStart(3, '0'),
    notes: { es: i === 0 ? 'Apuntador privado.\nSegunda línea.' : '' }, ...(i === 0 ? { pollIds: ['poll-a'], knowledgeIds: ['quiz-a'], raffleIds: ['raffle-a'], gameIds: ['pong'] } : {}) })),
    polls: [{ id: 'poll-a', type: 'poll', title: 'Encuesta', prompt: '¿Una o dos?', options: [{ id: 'a', label: 'Una' }, { id: 'b', label: 'Dos' }], en: { prompt: 'One or two?', options: { a: 'One', b: 'Two' } } }],
    knowledge: [{ id: 'quiz-a', category: 'contest', title: 'Conocimiento', identificationMode: 'anonymous', questionDurationSeconds: 15,
      questions: [{ id: 'q-a', prompt: '¿Cuál?', options: [{ id: 'a', label: 'Primera', correct: true }, { id: 'b', label: 'Segunda' }] }] }],
    raffles: [{ id: 'raffle-a', mode: 'free', title: 'Sorteo', prompt: 'Participa', options: [] }], games: [{ id: 'pong', durationMs: 60000 }] };
}
module.exports = { configurationFixture };
