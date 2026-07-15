(function(root){
const ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l3 2M9 2h6"></path></svg>';
function role(path){if(/^\/(?:speaker|presenter)(?:\/|$)/.test(path))return'presenter';if(/^\/stage(?:\/|$)/.test(path))return'stage';if(/^\/(?:screen|