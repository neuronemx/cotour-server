(function (global) {
  function resolve(interaction, locale) {
    if (!interaction) return interaction;
    const options = Array.isArray(interaction.options)
      ? interaction.options.map((option) => ({ ...option }))
      : [];
    if (locale !== 'en') return { ...interaction, options };
    const english = interaction.en && typeof interaction.en === 'object' ? interaction.en : {};
    const englishOptions = english.options && typeof english.options === 'object' ? english.options : {};
    return {
      ...interaction,
      prompt: String(english.prompt || interaction.promptEn || interaction.prompt || '').trim(),
      options: options.map((option) => ({
        ...option,
        label: String(englishOptions[option.id] || option.labelEn || option.label || '').trim()
      }))
    };
  }
  const api = { resolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ImmersaPollLocale = api;
})(typeof window !== 'undefined' ? window : globalThis);
