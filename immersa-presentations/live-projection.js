// Speaker LIVE and guest LIVE share one program output for each Deck session.
function createLiveProjection() {
  const owners = new Map();
  const key = (sessionId, deckId) => JSON.stringify([sessionId, deckId]);
  return {
    acquire(sessionId, deckId, owner) {
      const room = key(sessionId, deckId);
      if (owners.has(room) && owners.get(room) !== owner) return false;
      owners.set(room, owner);
      return true;
    },
    release(sessionId, deckId, owner) {
      const room = key(sessionId, deckId);
      if (owners.get(room) === owner) owners.delete(room);
    }
  };
}
module.exports = { createLiveProjection };
