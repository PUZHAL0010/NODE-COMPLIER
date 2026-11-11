/**
 * Lightweight in-memory DOM & innerHTML Shim for Node.js execution sandbox.
 * Enables user scripts using document, window, element.innerHTML, createElement,
 * getElementById, querySelector, etc. to run in Node.js without crashing.
 */

export const DOM_SHIM_SOURCE = `// Universal DOM & innerHTML Polyfill for Node.js Sandbox
(function() {
  if (typeof global === 'undefined') return;

  class DOMNode {
    constructor(tagName = 'div', id = '') {
      this.tagName = String(tagName).toUpperCase();
      this.nodeName = this.tagName;
      this.nodeType = 1;
      this.id = id || '';
      this.className = '';
      this._innerHTML = '';
      this.children = [];
      this.childNodes = this.children;
      this.attributes = {};
      this.style = {};
      this.parentNode = null;
      this.parentElement = null;
      this._listeners = {};

      const self = this;
      this.classList = {
        add: (...cls) => {
          const set = new Set((self.className || '').split(/\\s+/).filter(Boolean));
          cls.forEach(c => set.add(c));
          self.className = Array.from(set).join(' ');
        },
        remove: (...cls) => {
          const set = new Set((self.className || '').split(/\\s+/).filter(Boolean));
          cls.forEach(c => set.delete(c));
          self.className = Array.from(set).join(' ');
        },
        toggle: (c) => {
          const set = new Set((self.className || '').split(/\\s+/).filter(Boolean));
          if (set.has(c)) set.delete(c); else set.add(c);
          self.className = Array.from(set).join(' ');
        },
        contains: (c) => {
          return (self.className || '').split(/\\s+/).includes(c);
        }
      };
    }

    get innerHTML() {
      if (this._innerHTML) return this._innerHTML;
      return this.children.map(c => c.outerHTML || c.toString()).join('');
    }

    set innerHTML(val) {
      this._innerHTML = String(val == null ? '' : val);
      this.children = [];
      this.childNodes = this.children;
    }

    get textContent() {
      return this.innerHTML.replace(/<[^>]*>/g, '');
    }

    set textContent(txt) {
      this._innerHTML = String(txt == null ? '' : txt)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      this.children = [];
    }

    get innerText() {
      return this.textContent;
    }

    set innerText(txt) {
      this.textContent = txt;
    }

    get outerHTML() {
      const tag = this.tagName.toLowerCase();
      let attrs = '';
      if (this.id) attrs += ' id="' + this.id + '"';
      if (this.className) attrs += ' class="' + this.className + '"';
      for (const [k, v] of Object.entries(this.attributes)) {
        if (k !== 'id' && k !== 'class') attrs += ' ' + k + '="' + v + '"';
      }
      return '<' + tag + attrs + '>' + this.innerHTML + '</' + tag + '>';
    }

    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
        child.parentElement = null;
      }
      return child;
    }

    replaceChild(newChild, oldChild) {
      const idx = this.children.indexOf(oldChild);
      if (idx !== -1) {
        this.children[idx] = newChild;
        newChild.parentNode = this;
        newChild.parentElement = this;
        oldChild.parentNode = null;
        oldChild.parentElement = null;
      }
      return oldChild;
    }

    insertBefore(newChild, refChild) {
      const idx = this.children.indexOf(refChild);
      if (idx !== -1) {
        this.children.splice(idx, 0, newChild);
      } else {
        this.children.push(newChild);
      }
      newChild.parentNode = this;
      newChild.parentElement = this;
      return newChild;
    }

    setAttribute(name, val) {
      this.attributes[name] = String(val);
      if (name === 'id') this.id = String(val);
      if (name === 'class') this.className = String(val);
    }

    getAttribute(name) {
      if (name === 'id') return this.id || null;
      if (name === 'class') return this.className || null;
      return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }

    removeAttribute(name) {
      delete this.attributes[name];
      if (name === 'id') this.id = '';
      if (name === 'class') this.className = '';
    }

    hasAttribute(name) {
      return this.attributes[name] !== undefined;
    }

    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(fn);
    }

    removeEventListener(type, fn) {
      if (this._listeners[type]) {
        this._listeners[type] = this._listeners[type].filter(cb => cb !== fn);
      }
    }

    dispatchEvent(event) {
      const type = event?.type || event;
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => {
          try { fn.call(this, event || { type, target: this }); } catch(e) {}
        });
      }
      return true;
    }

    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }

    querySelector(selector) {
      if (typeof selector !== 'string') return null;
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (this.id === id) return this;
        for (const c of this.children) {
          if (c.id === id) return c;
          const found = c.querySelector?.(selector);
          if (found) return found;
        }
      }
      return this.children[0] || null;
    }

    querySelectorAll(selector) {
      const res = [];
      if (selector.startsWith('#')) {
        const item = this.querySelector(selector);
        if (item) res.push(item);
      } else {
        res.push(...this.children);
      }
      return res;
    }
  }

  const elementsByIdMap = new Map();

  const doc = {
    body: new DOMNode('body'),
    head: new DOMNode('head'),
    documentElement: new DOMNode('html'),
    createElement(tag) {
      return new DOMNode(tag);
    },
    createTextNode(text) {
      const node = new DOMNode('span');
      node.textContent = text;
      return node;
    },
    getElementById(id) {
      if (!id || typeof id !== 'string') return null;
      if (elementsByIdMap.has(id)) {
        return elementsByIdMap.get(id);
      }
      // Auto-create element if missing so innerHTML assignment never throws null error
      const el = new DOMNode('div', id);
      elementsByIdMap.set(id, el);
      doc.body.appendChild(el);
      return el;
    },
    getElementsByClassName(cls) {
      const result = [];
      for (const el of elementsByIdMap.values()) {
        if (el.classList.contains(cls)) result.push(el);
      }
      return result;
    },
    getElementsByTagName(tag) {
      const target = String(tag).toUpperCase();
      const result = [];
      for (const el of elementsByIdMap.values()) {
        if (el.tagName === target) result.push(el);
      }
      return result;
    },
    querySelector(selector) {
      if (typeof selector !== 'string') return null;
      if (selector === 'body') return doc.body;
      if (selector === 'head') return doc.head;
      if (selector.startsWith('#')) {
        return doc.getElementById(selector.slice(1));
      }
      return doc.body.querySelector(selector);
    },
    querySelectorAll(selector) {
      const el = doc.querySelector(selector);
      return el ? [el] : [];
    },
    addEventListener(event, fn) {},
    removeEventListener(event, fn) {}
  };

  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  if (!global.document) {
    global.document = doc;
  }
  if (!global.window) {
    global.window = global;
  }
  if (!global.HTMLElement) {
    global.HTMLElement = DOMNode;
  }
  if (!global.Element) {
    global.Element = DOMNode;
  }
  if (!global.Node) {
    global.Node = DOMNode;
  }
})();
`;
