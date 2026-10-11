const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDefinition, createExecution } = require('../knowledge-activity-engine');

for (const category of ['contest', 'assessment']) {
  test(`${category} snapshots English labels against stable question and option IDs`, () => {
    const input = {
      id: 'activity-1', category, title: 'Evaluación', titleEn: 'Assessment',
      questions: [{ id: 'q1', prompt: 'Pregunta', en: { prompt: 'Question', options: { a: 'One', b: 'Two' } },
        options: [{ id: 'a', label: 'Uno' }, { id: 'b', label: 'Dos' }], correctOptionId: 'a' }]
    };
    const normalized = normalizeDefinition(input);
    assert.equal(normalized.titleEn, 'Assessment');
    assert.deepEqual(normalized.questions[0].en.options, { a: 'One', b: 'Two' });
    const execution = createExecution({ presentationSessionId: 'session-1', sourceSessionId: 'session-1', deckId: 'deck-a', definition: input });
    assert.equal(execution.definition.questions[0].en.prompt, 'Question');
    input.questions[0].en.prompt = 'Edited later';
    assert.equal(execution.definition.questions[0].en.prompt, 'Question');
  });
}
