// ─── virtlist.js ─────────────────────────────────────────────────────────────
// Shared virtual-scroll list over a filtered event array (used by the Log tab
// and the Dmg Calc tab). A Fenwick tree over per-row heights gives O(log n)
// offset↔index mapping; only rows near the viewport are in the DOM. Also owns
// the height bookkeeping around open/close: a closed row costs `est` px, an
// open row's measured height, plus optional per-row extra height (the Log
// tab's row spacers).

class Fenwick {
    constructor(size) {
        this.size = size;
        this.tree = new Array(size + 1).fill(0);
    }
    add(idx, delta) {
        if (idx < 0 || idx >= this.size) return;
        for (let i = idx + 1; i <= this.size; i += i & -i) {
            this.tree[i] += delta;
        }
    }
    prefixSum(idx) {
        if (idx < 0) return 0;
        if (idx >= this.size) idx = this.size - 1;
        let sum = 0;
        for (let i = idx + 1; i > 0; i -= i & -i) {
            sum += this.tree[i];
        }
        return sum;
    }
}

class VirtList {
    // cfg:
    //   est          — estimated closed-row height
    //   buffer       — rows rendered beyond the viewport on either side
    //   container    — scrolling container element
    //   content      — positioned row container inside the container
    //   spacer       — element kept at totalHeight (optional)
    //   spacerHeight — enables the per-row spacer feature (optional)
    //   buildBody    — (ev) => innerHTML for an open row's body
    //   createRow    — (ev, filteredIdx) => fresh row element
    //   refreshRow   — (el, ev) => refresh computed values on an existing row (optional)
    //   decorate     — () => per-row decoration sweep after render (optional)
    //   subKeyPrefix — prefix for subOpenStates keys ('' or 'dc_')
    constructor(cfg) {
        this.cfg = cfg;
        this.filtered = [];
        this.openStates = {};
        this.measuredHeights = {};
        this.subOpenStates = {};
        this.heights = [];
        this.fenwick = null;
        this.totalHeight = 0;
        this.spacerByOrig = new Map();
        this.scrollScheduled = false;

        cfg.container.addEventListener('scroll', () => {
            if (this.scrollScheduled) return;
            this.scrollScheduled = true;
            requestAnimationFrame(() => {
                this.render();
                this.scrollScheduled = false;
            });
        });

        // Collapsible sub-sections inside open row bodies: open-state lives in
        // subOpenStates under "<oi>_<targetId>", the row is re-measured and
        // neighbours are shifted accordingly.
        cfg.content.addEventListener('click', e => {
            const toggle = e.target.closest('.collapsible-toggle');
            if (!toggle) return;
            e.stopPropagation();

            const targetId = toggle.dataset.target;
            const contentEl = document.getElementById(targetId);
            if (!contentEl) return;

            const isOpen = toggle.classList.toggle('open');
            contentEl.style.display = isOpen ? 'block' : 'none';

            const eventDiv = toggle.closest('.event');
            if (!eventDiv) return;
            const oi = parseInt(eventDiv.dataset.origIndex);
            const filteredIdx = parseInt(eventDiv.dataset.filteredIndex);
            const key = `${cfg.subKeyPrefix}${oi}_${targetId}`;
            this.subOpenStates[key] = isOpen;

            const savedScroll = cfg.container.scrollTop;
            requestAnimationFrame(() => {
                const actual = eventDiv.getBoundingClientRect().height;
                if (actual > 0 && !isNaN(filteredIdx)) {
                    const delta = this.updateHeight(filteredIdx, actual);
                    this.measuredHeights[oi] = actual;
                    if (Math.abs(delta) > 0.5) {
                        this.shiftAfter(filteredIdx, delta);
                    }
                }
                const maxScroll = this.totalHeight - cfg.container.clientHeight;
                cfg.container.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
            });
        });
    }

    setFiltered(arr) { this.filtered = arr; }

    topOf(fi) { return this.fenwick.prefixSum(fi - 1); }

    // Current height of a row in the event-only domain (closed rows use the
    // estimate, open rows the last measured height).
    heightFor(oi) {
        const m = this.measuredHeights[oi];
        return (this.openStates[oi] && m) ? m : this.cfg.est;
    }

    extraHeight(oi) {
        return this.cfg.spacerHeight ? (this.spacerByOrig.get(oi) || 0) : 0;
    }

    build(minCapacity) {
        // Capacity grows geometrically (via minCapacity from the fold path) so
        // appends are amortized O(1); a Fenwick can't be "grown by copy" once it
        // has pending adds, so growth is always a full rebuild from `heights`.
        const capacity = Math.max(minCapacity || 0, this.filtered.length, 1);
        this.fenwick = new Fenwick(capacity);
        this.heights = new Array(this.filtered.length);
        let sum = 0;
        for (let i = 0; i < this.filtered.length; i++) {
            const orig = this.filtered[i]._origIndex;
            const h = this.heightFor(orig) + this.extraHeight(orig);
            this.heights[i] = h;
            this.fenwick.tree[i + 1] = h;
            sum += h;
        }
        // O(n) build: propagate children into parents across the full capacity so
        // that cells beyond `filtered.length` are consistent for later appends.
        for (let i = 1; i <= this.fenwick.size; i++) {
            const p = i + (i & -i);
            if (p <= this.fenwick.size) this.fenwick.tree[p] += this.fenwick.tree[i];
        }
        this.totalHeight = sum;
        this.syncSpacer();
    }

    // Append one row height (incremental fold path); index = heights.length.
    // Doesn't touch the spacer element — call syncSpacer() once after a batch.
    appendHeight(h) {
        const idx = this.heights.length;
        this.heights.push(h);
        this.totalHeight += h;
        this.fenwick.add(idx, h);
    }

    syncSpacer() {
        if (this.cfg.spacer) this.cfg.spacer.style.height = this.totalHeight + 'px';
    }

    updateHeight(idx, newEventHeight) {
        const orig = this.filtered[idx]._origIndex;
        const newTotal = newEventHeight + this.extraHeight(orig);
        const old = this.heights[idx];
        if (Math.abs(old - newTotal) < 0.5) return 0;
        this.heights[idx] = newTotal;
        const delta = newTotal - old;
        this.fenwick.add(idx, delta);
        this.totalHeight += delta;
        this.syncSpacer();
        return delta;
    }

    findIndexForOffset(target) {
        if (this.filtered.length === 0) return 0;
        const clamped = Math.max(0, Math.min(target, this.totalHeight));
        if (clamped <= 0) return 0;
        if (clamped >= this.totalHeight) return this.filtered.length - 1;

        let lo = 0, hi = this.filtered.length - 1, ans = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this.fenwick.prefixSum(mid) >= clamped) {
                ans = mid;
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }
        return ans;
    }

    // Index of an event's _origIndex in `filtered`, by binary search. Both
    // filter paths build `filtered` in _origIndex order, so this is O(log n).
    filteredIndexOfOrig(orig) {
        let lo = 0, hi = this.filtered.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const oi = this.filtered[mid]._origIndex;
            if (oi === orig) return mid;
            if (oi < orig) lo = mid + 1;
            else hi = mid - 1;
        }
        return -1;
    }

    shiftAfter(startIndex, delta) {
        this.cfg.content.querySelectorAll('.event').forEach(el => {
            const idx = parseInt(el.dataset.filteredIndex);
            if (!isNaN(idx) && idx > startIndex) {
                el.style.top = (parseFloat(el.style.top) + delta) + 'px';
            }
        });
        if (this.cfg.spacerHeight) this.renderSpacers();
    }

    toggleEvent(origIndex) {
        const eventDiv = this.cfg.content.querySelector(`.event[data-orig-index="${origIndex}"]`);
        if (!eventDiv) return;

        const filteredIdx = parseInt(eventDiv.dataset.filteredIndex);

        const savedScroll = this.cfg.container.scrollTop;
        const wasOpen = this.openStates[origIndex] || false;

        if (wasOpen) {
            this.openStates[origIndex] = false;
            const body = eventDiv.querySelector('.event-body');
            if (body) body.innerHTML = '';

            const topOfThis = this.topOf(filteredIdx);
            const relativeScroll = savedScroll - topOfThis;

            eventDiv.classList.remove('open');
            const delta = this.updateHeight(filteredIdx, this.cfg.est);
            delete this.measuredHeights[origIndex];
            this.shiftAfter(filteredIdx, delta);

            this.cfg.container.scrollTop = topOfThis + relativeScroll;
        } else {
            this.openStates[origIndex] = true;
            const body = eventDiv.querySelector('.event-body');
            if (body) body.innerHTML = this.cfg.buildBody(allEvents[origIndex]);
            eventDiv.classList.add('open');

            requestAnimationFrame(() => {
                const actual = eventDiv.getBoundingClientRect().height;
                if (actual > 0) {
                    this.measuredHeights[origIndex] = actual;
                    const delta = this.updateHeight(filteredIdx, actual);
                    if (Math.abs(delta) > 0.5) {
                        this.shiftAfter(filteredIdx, delta);
                        const maxScroll = this.totalHeight - this.cfg.container.clientHeight;
                        this.cfg.container.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
                        this.render();
                    }
                }
            });
        }
    }

    render() {
        const content = this.cfg.content;
        if (!this.filtered.length) {
            content.innerHTML = '';
            return;
        }

        const scrollTop = this.cfg.container.scrollTop;
        const viewH = this.cfg.container.clientHeight;
        const startIdx = this.findIndexForOffset(scrollTop);
        let start = Math.max(0, startIdx - this.cfg.buffer);
        const endIdx = this.findIndexForOffset(scrollTop + viewH);
        let end = Math.min(this.filtered.length, endIdx + this.cfg.buffer);
        if (start >= this.filtered.length) start = Math.max(0, this.filtered.length - 1);

        const neededOrig = new Set();
        // Build a fresh orig→filteredIndex map so we never use stale dataset values
        const origToFi = new Map();
        for (let i = start; i < end; i++) {
            neededOrig.add(this.filtered[i]._origIndex);
            origToFi.set(this.filtered[i]._origIndex, i);
        }

        const existing = content.querySelectorAll('.event');
        for (const el of existing) {
            const oi = parseInt(el.dataset.origIndex);
            if (neededOrig.has(oi)) {
                const fi = origToFi.get(oi);
                el.dataset.filteredIndex = fi; // keep dataset in sync
                const newTop = this.topOf(fi);
                if (el.style.top !== newTop + 'px') {
                    el.style.top = newTop + 'px';
                }
                const shouldOpen = this.openStates[oi] || false;
                const isOpen = el.classList.contains('open');
                if (shouldOpen !== isOpen) {
                    el.classList.toggle('open', shouldOpen);
                    const body = el.querySelector('.event-body');
                    if (body) {
                        if (shouldOpen && body.innerHTML.trim() === '') {
                            body.innerHTML = this.cfg.buildBody(allEvents[oi]);
                        } else if (!shouldOpen) {
                            body.innerHTML = '';
                        }
                    }
                }
                if (this.cfg.refreshRow) this.cfg.refreshRow(el, allEvents[oi]);
                neededOrig.delete(oi);
            } else {
                el.remove();
            }
        }

        for (const oi of neededOrig) {
            const fi = origToFi.get(oi);
            if (fi === undefined || fi === -1) continue;
            content.appendChild(this.cfg.createRow(allEvents[oi], fi));
        }

        if (this.cfg.decorate) this.cfg.decorate();
        if (this.cfg.spacerHeight) this.renderSpacers();
    }

    reset() {
        this.openStates = {};
        this.measuredHeights = {};
        this.subOpenStates = {};
        this.spacerByOrig.clear();
        this.cfg.content.innerHTML = '';
    }

    // ─── Row spacers (Log tab) ─────────────────
    toggleSpacer(orig) {
        const fi = this.filteredIndexOfOrig(orig);
        if (fi === -1) return;

        const currentSpacerH = this.spacerByOrig.get(orig) || 0;
        const eventOnlyH = this.heights[fi] - currentSpacerH;

        if (this.spacerByOrig.has(orig)) {
            this.spacerByOrig.delete(orig);
        } else {
            this.spacerByOrig.set(orig, this.cfg.spacerHeight);
        }

        const savedScroll = this.cfg.container.scrollTop;
        const delta = this.updateHeight(fi, eventOnlyH);
        this.shiftAfter(fi, delta);
        const maxScroll = this.totalHeight - this.cfg.container.clientHeight;
        this.cfg.container.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
        this.render();
    }

    renderSpacers() {
        const content = this.cfg.content;
        content.querySelectorAll('.event-spacer').forEach(el => el.remove());
        if (this.spacerByOrig.size === 0) return;

        content.querySelectorAll('.event').forEach(el => {
            const oi = parseInt(el.dataset.origIndex);
            const fi = parseInt(el.dataset.filteredIndex);
            const sh = this.spacerByOrig.get(oi) || 0;
            if (sh === 0) return;

            const actualEventH = el.getBoundingClientRect().height;
            const topOfSlot = this.topOf(fi);
            const spacerTop = topOfSlot + actualEventH;
            const spacerBottom = topOfSlot + this.heights[fi];
            const renderedH = Math.max(1, spacerBottom - spacerTop);

            const sd = document.createElement('div');
            sd.className = 'event-spacer';
            sd.style.top = spacerTop + 'px';
            sd.style.height = renderedH + 'px';
            sd.addEventListener('click', () => this.toggleSpacer(oi));
            content.appendChild(sd);
        });
    }
}
