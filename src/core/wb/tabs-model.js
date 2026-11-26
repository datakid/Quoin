export const keyOf = (item) => `${item.type}:${item.name}`;

function emptyGroup() {
  return { tabs: [], active: null };
}

export class TabModel {
  constructor() {
    this.groups = [emptyGroup()];
    this.activeGroup = 0;
    this.memory = new Map();
    this.lastRemoved = null;
  }

  find(key) {
    for (let g = 0; g < this.groups.length; g++) {
      const i = this.groups[g].tabs.findIndex((t) => t.key === key);
      if (i >= 0) return { g, i, tab: this.groups[g].tabs[i] };
    }
    return null;
  }

  isOpen(key) {
    return this.find(key) !== null;
  }

  keys(g = null) {
    const list = g === null ? this.groups : [this.groups[g]];
    return list.flatMap((grp) => grp.tabs.map((t) => t.key));
  }

  get active() {
    return this.groups[this.activeGroup].active;
  }

  activeItem() {
    const key = this.active;
    const hit = key ? this.find(key) : null;
    return hit ? hit.tab.item : null;
  }

  open(item, { preview = false, group = null } = {}) {
    const key = keyOf(item);
    const hit = this.find(key);
    if (hit) {
      if (!preview && hit.tab.preview) hit.tab.preview = false;
      this.groups[hit.g].active = key;
      this.activeGroup = hit.g;
      return { group: hit.g, key, created: false, replaced: null };
    }
    const g = group !== null && group < this.groups.length ? group : this.activeGroup;
    const grp = this.groups[g];
    const tab = { key, item: { type: item.type, name: item.name }, preview: !!preview };
    let replaced = null;
    const previewAt = preview ? grp.tabs.findIndex((t) => t.preview) : -1;
    if (previewAt >= 0) {
      replaced = grp.tabs[previewAt].key;
      grp.tabs[previewAt] = tab;
    } else {
      const at = grp.active ? grp.tabs.findIndex((t) => t.key === grp.active) : -1;
      grp.tabs.splice(at >= 0 ? at + 1 : grp.tabs.length, 0, tab);
    }
    grp.active = key;
    this.activeGroup = g;
    if (replaced) this.memory.delete(replaced);
    return { group: g, key, created: true, replaced };
  }

  activate(key) {
    const hit = this.find(key);
    if (!hit) return false;
    this.groups[hit.g].active = key;
    this.activeGroup = hit.g;
    return true;
  }

  focusGroup(g) {
    if (g < 0 || g >= this.groups.length) return false;
    this.activeGroup = g;
    return true;
  }

  makePermanent(key) {
    const hit = this.find(key);
    if (!hit || !hit.tab.preview) return false;
    hit.tab.preview = false;
    return true;
  }

  close(key) {
    this.lastRemoved = null;
    const hit = this.find(key);
    if (!hit) return { closed: false, next: this.active, groupRemoved: false };
    const grp = this.groups[hit.g];
    grp.tabs.splice(hit.i, 1);
    let groupRemoved = false;
    if (grp.active === key) grp.active = grp.tabs.length ? grp.tabs[Math.min(hit.i, grp.tabs.length - 1)].key : null;
    if (!grp.tabs.length && this.groups.length > 1) {
      this.groups.splice(hit.g, 1);
      groupRemoved = true;
      this.lastRemoved = hit.g;
      this.activeGroup = 0;
    }
    this.memory.delete(key);
    return { closed: true, next: this.groups[this.activeGroup].active, groupRemoved };
  }

  canSplit() {
    if (this.groups.length > 1) return true;
    return this.groups[0].tabs.length >= 2 ? true : 'tabs.fewerThanTwo';
  }

  split() {
    const ok = this.canSplit();
    if (ok !== true || this.groups.length > 1) return false;
    const left = this.groups[0];
    const key = left.active;
    const at = left.tabs.findIndex((t) => t.key === key);
    const [tab] = left.tabs.splice(at, 1);
    left.active = left.tabs.length ? left.tabs[Math.min(at, left.tabs.length - 1)].key : null;
    this.groups.push({ tabs: [tab], active: key });
    this.activeGroup = 1;
    return true;
  }

  join() {
    this.lastRemoved = null;
    if (this.groups.length < 2) return false;
    const key = this.active;
    const [a, b] = this.groups;
    a.tabs.push(...b.tabs);
    a.active = key;
    this.groups = [a];
    this.activeGroup = 0;
    this.lastRemoved = 1;
    return true;
  }

  toggleSplit() {
    return this.groups.length > 1 ? this.join() : this.split();
  }

  move(key, toGroup, index = null) {
    this.lastRemoved = null;
    const hit = this.find(key);
    if (!hit) return false;
    if (toGroup === hit.g) return false;
    if (toGroup >= this.groups.length) {
      if (this.groups.length > 1 || toGroup !== 1 || this.groups[0].tabs.length < 2) return false;
      this.groups.push(emptyGroup());
    }
    const src = this.groups[hit.g];
    const dst = this.groups[toGroup];
    const [tab] = src.tabs.splice(hit.i, 1);
    const at = index === null ? dst.tabs.length : Math.max(0, Math.min(dst.tabs.length, index));
    dst.tabs.splice(at, 0, tab);
    dst.active = key;
    if (src.active === key) src.active = src.tabs.length ? src.tabs[Math.min(hit.i, src.tabs.length - 1)].key : null;
    if (!src.tabs.length) {
      this.groups.splice(hit.g, 1);
      this.lastRemoved = hit.g;
      this.activeGroup = 0;
    } else this.activeGroup = toGroup;
    return true;
  }

  groupOf(key) {
    const hit = this.find(key);
    return hit ? hit.g : -1;
  }

  cycle(dir) {
    const grp = this.groups[this.activeGroup];
    if (!grp.tabs.length) return null;
    const at = grp.tabs.findIndex((t) => t.key === grp.active);
    const next = grp.tabs[(at + dir + grp.tabs.length) % grp.tabs.length];
    grp.active = next.key;
    return next.key;
  }

  goTo(n) {
    const grp = this.groups[this.activeGroup];
    const tab = grp.tabs[n - 1];
    if (!tab) return null;
    grp.active = tab.key;
    return tab.key;
  }

  remember(key, state) {
    this.memory.set(key, { ...state });
  }

  recall(key) {
    return this.memory.get(key) || null;
  }
}
