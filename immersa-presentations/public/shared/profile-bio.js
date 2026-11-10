(function (root) {
  "use strict";

  function render(node, value, ranges) {
    const text = String(value || "");
    const document = node.ownerDocument;
    node.textContent = "";
    let position = 0;
    for (const pair of Array.isArray(ranges) ? ranges : []) {
      if (!Array.isArray(pair)) continue;
      const [start, end] = pair;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < position || end <= start || end > text.length) continue;
      if (start > position) node.append(document.createTextNode(text.slice(position, start)));
      const strong = document.createElement("strong");
      strong.textContent = text.slice(start, end);
      node.append(strong);
      position = end;
    }
    if (position < text.length) node.append(document.createTextNode(text.slice(position)));
  }

  root.ImmersaProfileBio = { render };
})(window);
