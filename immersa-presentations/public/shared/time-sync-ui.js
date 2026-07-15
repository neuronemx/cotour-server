(function (root) {
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l3 2M9 2h6"></path></svg>';

  function roleFromPath(pathname) {
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(pathname)) return "presenter";
    if (/^\/stage(?:\/|$)/.test(pathname)) return "stage";
    if (/^\/(?:screen|viewer)(?:\/