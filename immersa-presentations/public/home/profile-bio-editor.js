(function () {
  "use strict";

  const limit = 600;
  const blocks = new Set(["DIV", "P", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);
  const ignored = new Set(["SCRIPT", "STYLE", "META", "LINK", "NOSCRIPT", "TEMPLATE", "TITLE", "HEAD"]);

  function read(container) {
    let bio = "";
    const bioBold = [];

    function append(text, bold) {
      if (!text) return;
      const start = bio.length;
      bio += text;
      if (bold) {
        const previous = bioBold[bioBold.length - 1];
        if (previous?.[1] === start) previous[1] = bio.length;
        else bioBold.push([start, bio.length]);
      }
    }

    function walk(parent, bold, insideBlock) {
      let previousBlock = false;
      let previousContent = false;
      for (const node of parent.childNodes) {
        const tag = node.tagName;
        if (ignored.has(tag) || (node.nodeType !== 1 && node.nodeType !== 3)) continue;
        if (tag === "O:P" && !node.textContent.trim()) continue;
        const block = blocks.has(tag);
        if (node.nodeType === 3 && !node.data.trim() &&
            (previousBlock || blocks.has(node.nextSibling?.tagName))) continue;
        if ((previousBlock || (block && previousContent)) && !bio.endsWith("\n")) append("\n", false);
        if (node.nodeType === 3) {
          append(node.data, bold);
        } else if (tag === "BR") {
          // An empty editable line has a placeholder BR of its own.
          if (!insideBlock || node !== parent.lastChild) append("\n", bold);
        } else {
          const weight = node.style?.fontWeight;
          const childBold = weight ? weight === "bold" || weight === "bolder" || Number(weight) >= 600
            : bold || tag === "B" || tag === "STRONG";
          const start = bio.length;
          walk(node, childBold, block);
          if (block && bio.length === start) append("\n", false);
        }
        previousBlock = block;
        previousContent = true;
      }
    }
    walk(container, false, false);
    return { bio, bioBold };
  }

  function create(textarea) {
    const editor = document.createElement("div");
    editor.className = "profile-bio-editor";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", "Acerca de");
    editor.setAttribute("aria-multiline", "true");
    if (textarea.placeholder) {
      editor.dataset.placeholder = textarea.placeholder;
      editor.setAttribute("aria-placeholder", textarea.placeholder);
    }
    textarea.hidden = true;
    textarea.after(editor);

    function insert(text, ranges) {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      const range = selection.getRangeAt(0);
      const selected = read(range.cloneContents()).bio.length;
      const available = Math.max(0, limit - read(editor).bio.length + selected);
      const fragment = document.createElement("div");
      const clipped = text.slice(0, available).replace(/[\uD800-\uDBFF]$/, "");
      if (!clipped) return;
      window.ImmersaProfileBio.render(fragment, clipped, ranges
        .filter(([start]) => start < clipped.length)
        .map(([start, end]) => [start, Math.min(end, clipped.length)]));
      // Insert only text and strong elements generated above, preserving the browser's undo stack.
      const html = fragment.innerHTML.replaceAll("\n", "<br>");
      if (document.execCommand?.("insertHTML", false, html)) return;
      const contents = range.createContextualFragment(html);
      const last = contents.lastChild;
      range.deleteContents();
      range.insertNode(contents);
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    editor.addEventListener("paste", event => {
      event.preventDefault();
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const plain = clipboard.getData("text/plain").replace(/\r\n?/g, "\n");
      const html = clipboard.getData("text/html");
      if (html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        const rich = read(template.content);
        if (rich.bioBold.length) {
          insert(rich.bio, rich.bioBold);
          return;
        }
      }
      insert(plain, []);
    });

    editor.addEventListener("drop", event => event.preventDefault());

    return {
      editor,
      load(profile) { window.ImmersaProfileBio.render(editor, profile?.bio, profile?.bioBold); },
      read() { return read(editor); },
      disable(disabled) {
        editor.contentEditable = String(!disabled);
        editor.setAttribute("aria-disabled", String(disabled));
      }
    };
  }

  window.ImmersaProfileBioEditor = { create, limit };
})();
