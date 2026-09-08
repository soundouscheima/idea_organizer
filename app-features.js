/* ============================================
   Mulhim — Feature modules (loads after app-core.js)
   Editor toolbar, search, command palette, focus mode,
   templates, tag manager, trash, dashboard, calendar,
   knowledge graph, export/import, settings.
   ============================================ */
(function () {
    'use strict';
    const { Utils, DB, State, toast, confirmDialog, i18n } = window.Mulhim;
    const App = window.Mulhim.App;

    const Features = {
        pomodoroTimer: null,
        pomodoroRemaining: 25 * 60,
        pomodoroTotal: 25 * 60,
        pomodoroRunning: false,
        focusNoteId: null,
        graphNodes: [],
        graphLinks: [],
        graphZoom: 1,
        graphOffset: { x: 0, y: 0 },
        dragging: false,
        dragStart: null,
        calMonth: new Date().getMonth(),
        calYear: new Date().getFullYear()
    };
    window.Mulhim.Features = Features;

    /* ============================================
       Rich Text / Block Toolbar
       ============================================ */
    function bindToolbar() {
        const toolbar = document.getElementById('blockToolbar');
        toolbar.addEventListener('mousedown', (e) => e.preventDefault());

        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.toolbar-btn');
            if (!btn) return;
            const cmd = btn.dataset.cmd;
            App.els.editorBody.focus();
            handleCommand(cmd);
        });
    }

    function handleCommand(cmd) {
        const sel = window.getSelection();
        const body = App.els.editorBody;
        body.focus();
        switch (cmd) {
            case 'bold': document.execCommand('bold'); break;
            case 'italic': document.execCommand('italic'); break;
            case 'underline': document.execCommand('underline'); break;
            case 'strikethrough': document.execCommand('strikeThrough'); break;
            case 'h1': toggleBlockType('h1'); break;
            case 'h2': toggleBlockType('h2'); break;
            case 'h3': toggleBlockType('h3'); break;
            case 'quote': toggleBlockType('blockquote'); break;
            case 'code': toggleBlockType('pre'); break;
            case 'divider': insertDivider(); break;
            case 'checklist': insertChecklist(); break;
            case 'ul': insertList('ul'); break;
            case 'ol': insertList('ol'); break;
            case 'link': insertLink(); break;
            case 'image': document.getElementById('imageUploadInput').click(); break;
            case 'table': insertTable(); break;
        }
        App.els.editorBody.dispatchEvent(new Event('input'));
    }

    function toggleBlockType(type) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        let node = selection.anchorNode;
        if (node && node.nodeType === 3) node = node.parentElement;
        let container = node;
        while (container && container !== App.els.editorBody) {
            if (container.matches('p, div, h1,h2,h3, blockquote, pre, li')) break;
            container = container.parentElement;
        }
        if (!container || container === App.els.editorBody) {
            // wrap selection in block
            const newBlock = document.createElement(type);
            const frag = range.extractContents();
            newBlock.appendChild(frag);
            range.insertNode(newBlock);
            return;
        }
        const tag = container.tagName.toLowerCase();
        if (tag === type) {
            // un-toggle back to paragraph
            const p = document.createElement('p');
            container.after(p);
            while (container.firstChild) p.appendChild(container.firstChild);
            container.remove();
            if (selection) placeCaret(p);
        } else {
            const newEl = document.createElement(type);
            container.after(newEl);
            while (container.firstChild) newEl.appendChild(container.firstChild);
            container.remove();
            placeCaret(newEl);
        }
    }

    function placeCaret(el) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function insertDivider() {
        const hr = document.createElement('hr');
        insertNodeAtSelection(hr);
    }

    function insertChecklist() {
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        const li = document.createElement('li');
        li.className = 'checklist-item';
        li.innerHTML = `
            <input type="checkbox"><span contenteditable="true" style="flex:1;">Task</span>`;
        ul.appendChild(li);
        insertNodeAtSelection(ul);
        const span = li.querySelector('span');
        placeCaret(span);
    }

    function insertList(type) {
        window.getSelection().removeAllRanges();
        const el = document.createElement(type);
        const li = document.createElement('li');
        li.innerHTML = '<br>';
        el.appendChild(li);
        insertNodeAtSelection(el);
        placeCaret(li);
    }

    function insertNodeAtSelection(node) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function insertLink() {
        const url = prompt('Link URL (https://...):');
        if (!url) return;
        document.execCommand('createLink', false, url);
        App.els.editorBody.dispatchEvent(new Event('input'));
    }

    function insertTable() {
        const html = `
            <table><thead><tr><th>Column 1</th><th>Column 2</th></tr></thead>
            <tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>`;
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        insertNodeAtSelection(tmp.firstElementChild);
    }

    function normalizeDividerContent() {
        document.querySelectorAll('#editorBody hr').forEach((hr) => {
            if (hr.parentElement === App.els.editorBody) return;
        });
    }

    /* ============================================
       Editor content behaviors (checklists, links, words)
       ============================================ */
    function bindEditorEvents() {
        const body = App.els.editorBody;

        // Auto-save on input (debounced)
        body.addEventListener('input', Utils.debounce(() => {
            handleChecklistClick();
            handleInternalLinkTyping();
            App.els.editorBody.querySelectorAll('.checklist-item').forEach((li) => {
                const box = li.querySelector('input');
                li.classList.toggle('checked', box && box.checked);
            });
            App.saveEditorContent();
            App.refreshTaskProgress();
            App.refreshEditorMeta();
        }, 200));

        // handle clicks on checklist toggles + internal links
        body.addEventListener('click', (e) => {
            if (e.target.matches('.checklist-item input')) {
                setTimeout(() => {
                    const li = e.target.closest('.checklist-item');
                    li.classList.toggle('checked', e.target.checked);
                    App.els.editorBody.dispatchEvent(new Event('input'));
                }, 10);
            }
            if (e.target.matches('.internal-link')) {
                const title = e.target.dataset.title;
                const linkId = e.target.dataset.note;
                let target = linkId ? State.getNote(linkId) : null;
                if (!target) {
                    // create on click
                    target = App.createNote({ title: title, content: '', returnContent: false });
                    // update all occurrences of this link
                    const currentHtml = App.els.editorBody.innerHTML;
                    const newHtml = currentHtml.replace(
                        new RegExp(`<span class="internal-link" data-note="" data-title="${Utils.escapeHtml(title)}"[^>]*>${Utils.escapeHtml(title)}</span>`, 'g'),
                        `<span class="internal-link" data-note="${target.id}" data-title="${Utils.escapeHtml(title)}">${Utils.escapeHtml(title)}</span>`
                    );
                    DB.setContent(App.currentNoteId, newHtml).then(() => {
                        const b = App.els.editorBody;
                        const pos = document.getSelection();
                        b.innerHTML = newHtml;
                        App._lastSavedHtml = newHtml;
                    });
                    toast('Note created: ' + title, 'success');
                }
                App.saveEditorContent(true);
                App.openEditor(target.id);
            }
        });

        // Track active toolbar buttons
        body.addEventListener('keyup', () => updateToolbarState());
        body.addEventListener('mouseup', () => updateToolbarState());
        body.addEventListener('click', () => updateToolbarState());
        body.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
            }
        });

        bindBlockDrag(body);
    }

    /* Draggable, reorderable blocks */
    function bindBlockDrag(body) {
        let dragged = null;

        const blockFor = (el) => {
            let c = el;
            while (c && c !== body) {
                if (c.parentElement === body) return c;
                c = c.parentElement;
            }
            return null;
        };
        const isHandle = (el) => el && el.classList && el.classList.contains('block-handle');

        // Show drag handle on hover
        body.addEventListener('mouseover', (e) => {
            if (isHandle(e.target)) return;
            const block = blockFor(e.target);
            if (!block || block.querySelector('.block-handle')) return;
            const handle = document.createElement('span');
            handle.className = 'block-handle';
            handle.contentEditable = 'false';
            handle.draggable = true;
            handle.innerHTML = '⠿';
            handle.title = 'Drag to reorder';
            block.prepend(handle);
        });

        // Ensure only one handle per block at a time
        body.addEventListener('input', () => {
            body.querySelectorAll('.block-handle').forEach((h) => {
                if (h.parentElement.firstChild !== h) h.remove();
            });
            // drop floating handles whose parent was split by Enter
            body.querySelectorAll('.block-handle').forEach((h) => {
                if (!h.parentElement || h.parentElement === body) h.remove();
            });
        });

        const cleanup = () => {
            if (!dragged) return;
            dragged = null;
            body.querySelectorAll('.drag-ghost').forEach((el) => el.classList.remove('drag-ghost'));
        };

        body.addEventListener('dragstart', (e) => {
            const handle = e.target.closest('.block-handle');
            if (!handle) return;
            const block = handle.parentElement;
            dragged = block;
            block.classList.add('drag-ghost');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'block-reorder');
            // hide the handle while dragging to keep DOM clean
            handle.remove();
        });

        body.addEventListener('dragover', (e) => {
            if (!dragged) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = blockFor(e.target);
            if (!target || target === dragged) {
                body.classList.remove('drop-before', 'drop-after');
                return;
            }
            const rect = target.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            body.classList.toggle('drop-before', before);
            body.classList.toggle('drop-after', !before);
            delete e.dataTransfer;
        });

        body.addEventListener('drop', (e) => {
            if (!dragged) return;
            e.preventDefault();
            const target = blockFor(e.target);
            if (target && target !== dragged) {
                const rect = target.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                if (before) target.before(dragged);
                else target.after(dragged);
                App.saveEditorContent(true);
            }
            body.classList.remove('drop-before', 'drop-after');
            cleanup();
        });

        body.addEventListener('dragend', cleanup);
        body.addEventListener('dragleave', (e) => {
            if (!body.contains(e.relatedTarget)) {
                body.classList.remove('drop-before', 'drop-after');
            }
        });
    }

    function updateToolbarState() {
        const state = {
            bold: false, italic: false, underline: false, strikethrough: false
        };
        const sel = window.getSelection();
        if (sel.rangeCount && !sel.isCollapsed) {
            state.bold = document.queryCommandState('bold');
            state.italic = document.queryCommandState('italic');
            state.underline = document.queryCommandState('underline');
            state.strikethrough = document.queryCommandState('strikeThrough');
        }
        document.querySelectorAll('.toolbar-btn').forEach((btn) => {
            const cmd = btn.dataset.cmd;
            if (cmd in state) btn.classList.toggle('active', state[cmd]);
        });
    }

    function handleChecklistClick() {
        const body = App.els.editorBody;
        if (!body.querySelectorAll('.checklist-item').length) return;
    }

    function handleInternalLinkTyping() {
        const body = App.els.editorBody;
        // Convert [[Title]] to links (process first match per text node; input events repeat)
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const textNode = walker.currentNode;
            if (!/\[\[.*?\]\]/.test(textNode.textContent)) continue;
            const text = textNode.textContent;
            const m = text.match(/\[\[([^\]]+)\]\]/);
            if (!m) continue;
            const title = m[1].trim();
            const target = State.liveNotes().find((n) => (n.title || '').toLowerCase() === title.toLowerCase());
            const link = document.createElement('span');
            link.className = 'internal-link' + (target ? '' : ' unresolved');
            link.dataset.note = target ? target.id : '';
            link.dataset.title = title;
            link.textContent = title;
            const range = document.createRange();
            const start = text.indexOf(m[0]);
            try {
                range.setStart(textNode, start);
                range.setEnd(textNode, start + m[0].length);
                range.deleteContents();
                range.insertNode(link);
            } catch (err) { /* ignore */ }
            break;
        }
    }

    /* ============================================
       Search
       ============================================ */
    App.showSearch = function () {
        App.showView('search');
        populateSearchFilters();
        document.getElementById('searchInput').value = '';
        runSearch('');
    };

    function populateSearchFilters() {
        const folderSel = document.getElementById('searchFilterFolder');
        folderSel.innerHTML = '<option value="">All Folders</option>';
        State.folders.forEach((f) => {
            folderSel.innerHTML += `<option value="${f.id}">${Utils.escapeHtml(f.name)}</option>`;
        });
        const tagSel = document.getElementById('searchFilterTag');
        tagSel.innerHTML = '<option value="">All Tags</option>';
        State.tags.forEach((t) => {
            tagSel.innerHTML += `<option value="${t.id}">#${Utils.escapeHtml(t.name)}</option>`;
        });
    }

    function bindSearch() {
        const input = document.getElementById('searchInput');
        const results = document.getElementById('searchResults');
        const run = Utils.debounce(() => runSearch(input.value.trim()), 120);
        input.addEventListener('input', run);
        document.querySelectorAll('#searchView .filter-select').forEach((sel) => {
            sel.addEventListener('change', run);
        });
    }

    function highlight(text, q) {
        if (!q) return Utils.escapeHtml(text);
        const idx = text.toLowerCase().indexOf(q.toLowerCase());
        if (idx === -1) return Utils.escapeHtml(text);
        return Utils.escapeHtml(text.slice(0, idx)) +
            `<mark class="highlight">${Utils.escapeHtml(text.slice(idx, idx + q.length))}</mark>` +
            Utils.escapeHtml(text.slice(idx + q.length));
    }

    async function runSearch(query) {
        const results = document.getElementById('searchResults');
        const fFolder = document.getElementById('searchFilterFolder').value;
        const fTag = document.getElementById('searchFilterTag').value;
        const fDate = document.getElementById('searchFilterDate').value;

        let notes = State.liveNotes();
        // Folder filter (including subfolder contents handled by caller if selected)
        if (fFolder) {
            const allIds = new Set(State.allFolderIds(fFolder));
            notes = notes.filter((n) => allIds.has(n.folderId));
        }
        if (fTag) notes = notes.filter((n) => (n.tags || []).includes(fTag));
        if (fDate) {
            const now = Date.now();
            const startMap = {
                today: new Date(new Date().setHours(0,0,0,0)).getTime(),
                week: now - 7 * 24 * 60 * 60 * 1000,
                month: now - 30 * 24 * 60 * 60 * 1000
            };
            notes = notes.filter((n) => n.updatedAt >= startMap[fDate]);
        }

        if (!query && !fFolder && !fTag && !fDate) {
            results.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>Start typing to search...</p></div>`;
            return;
        }

        const q = query.toLowerCase();
        const matches = [];

        for (const note of notes) {
            let score = 0;
            let snippetParts = [];
            const title = note.title || '';
            const titleLower = title.toLowerCase();
            let titleHtml = Utils.escapeHtml(title || App.T('untitled'));
            if (titleLower.includes(q)) { score += 12; titleHtml = highlight(title, q); }
            // tags
            const tagNames = State.noteTags(note).map((t) => t.name);
            tagNames.forEach((name) => {
                if ('#' + name.toLowerCase().includes(q)) {
                    score += 5;
                    snippetParts.push('<span class="result-preview">#<i class="fas fa-tags" style="font-size:.7rem;"></i> ' + highlight(name, q) + '</span>');
                }
            });
            // folder
            const folderName = note.folderId ? (State.getFolder(note.folderId)?.name || '') : '';
            if (folderName.toLowerCase().includes(q)) score += 3;
            // content
            const html = await DB.getContent(note.id);
            const text = Utils.stripHtml(html);
            const textLower = text.toLowerCase();
            if (q && textLower.includes(q)) {
                score += 5;
                const idx = textLower.indexOf(q);
                const start = Math.max(0, idx - 60);
                const end = Math.min(text.length, idx + 90);
                snippetParts.push('<span class="result-preview">' + highlight(text.slice(start, end), q) + '</span>');
            } else if (text) {
                snippetParts.push('<span class="result-preview">' + Utils.escapeHtml(text.slice(0, 120)) + '</span>');
            }
            if (score > 0) {
                matches.push({ note, score, titleHtml, snippet: snippetParts.join(' '), tags: tagNames, folderName });
            }
        }

        matches.sort((a, b) => b.score - a.score);

        if (!matches.length) {
            results.innerHTML = `<div class="empty-state"><i class="fas fa-frown"></i><p>${App.T('noResults')}</p></div>`;
            return;
        }

        const dateSel = document.getElementById('searchFilterDate');
        const dateLabel = dateSel.selectedIndex > 0 ? dateSel.options[dateSel.selectedIndex].text : '';
        results.innerHTML = '';
        matches.forEach(({ note, titleHtml, snippet, tags, folderName }) => {
            const el = document.createElement('div');
            el.className = 'search-result-item';
            const folderBadge = folderName ? `<span class="result-meta-item"><i class="fas fa-folder"></i> ${Utils.escapeHtml(folderName)}</span>` : '<span class="result-meta-item"><i class="fas fa-folder-open"></i> Uncategorized</span>';
            const tagBadges = tags.length ? `<span class="result-meta-item"><i class="fas fa-tags"></i> ${tags.slice(0,3).map((tg) => '#' + Utils.escapeHtml(tg)).join(' ')}</span>` : '';
            el.innerHTML = `
                <div class="result-title">${titleHtml}</div>
                ${snippet ? `<div class="result-snippet">${snippet}</div>` : ''}
                <div class="result-meta">
                    <span class="result-meta-item"><i class="far fa-clock"></i> ${Utils.timeAgo(note.updatedAt)}</span>
                    ${folderBadge}
                    ${tagBadges}
                </div>`;
            el.addEventListener('click', () => App.openEditor(note.id));
            results.appendChild(el);
        });
    }

    /* ============================================
       Command Palette
       ============================================ */
    let paletteIndex = 0;
    function bindCommandPalette() {
        const overlay = document.getElementById('commandPalette');
        const input = document.getElementById('commandInput');
        const list = document.getElementById('commandList');

        const openPalette = () => {
            overlay.style.display = 'flex';
            input.value = '';
            paletteIndex = 0;
            renderCommands(parseCommand(''));
            input.focus();
        };
        window.Mulhim.openCommandPalette = openPalette;

        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePalette(); });
        const closePalette = () => { overlay.style.display = 'none'; };

        input.addEventListener('input', () => renderCommands(parseCommand(input.value)));

        input.addEventListener('keydown', (e) => {
            const items = list.querySelectorAll('.command-item');
            if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { paletteIndex = (paletteIndex + 1) % items.length; highlightCommand(items); } }
            else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { paletteIndex = (paletteIndex - 1 + items.length) % items.length; highlightCommand(items); } }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const item = items[paletteIndex];
                if (item) item.click();
            } else if (e.key === 'Escape') closePalette();
        });

        function highlightCommand(items) {
            items.forEach((it, i) => it.classList.toggle('active', i === paletteIndex));
            const active = items[paletteIndex];
            if (active) active.scrollIntoView({ block: 'nearest' });
        }

        function parseCommand(value) {
            const v = value.trim().toLowerCase();
            const cmds = [
                { icon: 'fa-plus', title: 'New Note', shortcut: 'Ctrl+N', action: () => { closePalette(); App.createNote(); } },
                { icon: 'fa-copy', title: 'New Note from Template', shortcut: '', action: () => { closePalette(); Features.pickTemplate(); } },
                { icon: 'fa-folder-plus', title: 'New Folder', shortcut: '', action: () => { closePalette(); App.promptCreateFolder(); } },
                { icon: 'fa-calendar-day', title: 'Open Today\'s Note', shortcut: '', action: () => { closePalette(); App.openDailyNote(); } },
                { icon: 'fa-search', title: 'Search All Notes', shortcut: 'Ctrl+K', action: () => { closePalette(); App.showSearch(); } },
                { icon: 'fa-expand', title: 'Focus Mode', shortcut: 'Ctrl+Shift+F', action: () => { closePalette(); if (App.currentNoteId) Features.openFocusMode(App.currentNoteId); } },
                { icon: 'fa-chart-line', title: 'Go to Dashboard', shortcut: '', action: () => { closePalette(); App.showView('dashboard'); } },
                { icon: 'fa-copy', title: 'Open Templates', shortcut: '', action: () => { closePalette(); App.showView('templates'); } },
                { icon: 'fa-tags', title: 'Open Tag Manager', shortcut: '', action: () => { closePalette(); App.showView('tagManager'); } },
                { icon: 'fa-trash', title: 'Open Trash', shortcut: '', action: () => { closePalette(); App.showView('trash'); } },
                { icon: 'fa-calendar-alt', title: 'Open Calendar', shortcut: '', action: () => { closePalette(); App.showView('calendar'); } },
                { icon: 'fa-project-diagram', title: 'Open Knowledge Graph', shortcut: '', action: () => { closePalette(); App.showView('graph'); } },
                { icon: 'fa-moon', title: 'Toggle Theme', shortcut: '', action: () => { closePalette(); App.toggleTheme(); } },
                { icon: 'fa-download', title: 'Export Backup', shortcut: '', action: () => { closePalette(); Features.exportBackup(); } },
                { icon: 'fa-folder-open', title: 'Go to All Notes', shortcut: '', action: () => { closePalette(); App.showView('notes'); } }
            ];
            return cmds.filter((c) => !v || c.title.toLowerCase().includes(v));
        }

        function renderCommands(cmds) {
            list.innerHTML = '';
            if (!cmds.length) {
                list.innerHTML = '<div style="padding:12px;color:var(--text-tertiary);font-size:.9rem;">No matching commands</div>';
                return;
            }
            cmds.forEach((c, i) => {
                const el = document.createElement('div');
                el.className = 'command-item' + (i === paletteIndex ? ' active' : '');
                el.innerHTML = `<i class="fas ${c.icon}"></i><span>${c.title}</span>${c.shortcut ? `<span class="cmd-shortcut"><kbd>${c.shortcut}</kbd></span>` : ''}`;
                el.addEventListener('mouseenter', () => { paletteIndex = i; updatePaletteActive(); });
                el.addEventListener('click', c.action);
                list.appendChild(el);
            });
        }

        function updatePaletteActive() {
            const items = list.querySelectorAll('.command-item');
            items.forEach((it, ix) => it.classList.toggle('active', ix === paletteIndex));
        }

        // Also allow searching notes directly
        const origInput = input.addEventListener;
        // extended: if query matches note titles, show below
        input.addEventListener('input', () => {
            const v = input.value.trim();
            if (!v) return;
            const noteMatches = State.liveNotes()
                .filter((n) => (n.title || '').toLowerCase().includes(v.toLowerCase()))
                .slice(0, 5);
            if (noteMatches.length && list.querySelectorAll('.command-item.note-results').length === 0) {
                const header = document.createElement('div');
                header.style.cssText = 'padding:8px 12px;font-size:.75rem;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;';
                header.textContent = 'Notes';
                list.appendChild(header);
                noteMatches.forEach((n) => {
                    const el = document.createElement('div');
                    el.className = 'command-item note-results';
                    el.innerHTML = `<i class="fas fa-file-alt"></i><span>${Utils.escapeHtml(n.title || 'Untitled')}</span>`;
                    el.addEventListener('click', () => { closePalette(); App.openEditor(n.id); });
                    list.appendChild(el);
                });
            }
        });
    }

    /* ============================================
       Focus Mode
       ============================================ */
    Features.openFocusMode = async function (noteId) {
        const note = State.getNote(noteId);
        if (!note) return;
        Features.focusNoteId = noteId;
        Features.pausePomodoro();
        Features.resetPomodoro();

        const mode = document.getElementById('focusMode');
        mode.style.display = 'flex';
        // if originally dark-on-light check current theme
        mode.dataset.bg = 'dark';

        document.getElementById('focusTitle').value = note.title || '';
        const html = await DB.getContent(noteId);
        // Guard against stale async loads (user may have exited/reopened focus mode)
        if (Features.focusNoteId !== noteId) return;
        document.getElementById('focusBody').innerHTML = App.parseInternalLinks(html);
        document.getElementById('focusBody').focus();
        document.getElementById('pomodoroTimer').textContent = '25:00';
    };

    Features.exitFocusMode = function () {
        const mode = document.getElementById('focusMode');
        const note = State.getNote(Features.focusNoteId);
        if (note) {
            const html = document.getElementById('focusBody').innerHTML;
            DB.setContent(note.id, html).then(() => {
                previewCacheUpdate(note.id, html);
            });
            note.title = document.getElementById('focusTitle').value.trim();
            note.updatedAt = Date.now();
            State.save(true);
            App.els.editorBody.innerHTML = App.parseInternalLinks(html);
            App.els.noteTitle.value = note.title || '';
            App._lastSavedHtml = html;
            App.refreshEditorMeta();
            App.refreshTaskProgress();
            App.renderSidebar();
        }
        Features.pausePomodoro();
        Features.resetPomodoro();
        mode.style.display = 'none';
    };

    function previewCacheUpdate(id, html) {
        try { window.Mulhim.App.getPreviewText(id).then((t) => { /* warm */ }); } catch (e) {}
    }

    // Pomodoro
    Features.startPomodoro = function (seconds) {
        Features.pausePomodoro();
        Features.pomodoroTotal = seconds;
        Features.pomodoroRemaining = seconds;
        Features.pomodoroRunning = true;
        Features.pomodoroTimer = setInterval(() => {
            Features.pomodoroRemaining -= 1;
            if (Features.pomodoroRemaining <= 0) {
                Features.pomodoroRemaining = Features.pomodoroTotal;
                toast('Pomodoro complete! Take a break.', 'success');
            }
            updatePomodoroUI();
        }, 1000);
        updatePomodoroUI();
    };
    Features.pausePomodoro = function () {
        Features.pomodoroRunning = false;
        clearInterval(Features.pomodoroTimer);
        Features.pomodoroTimer = null;
    };
    Features.resetPomodoro = function () {
        Features.pomodoroRemaining = 25 * 60;
        Features.pomodoroTotal = 25 * 60;
        clearInterval(Features.pomodoroTimer);
        Features.pomodoroTimer = null;
        Features.pomodoroRunning = false;
        const el = document.getElementById('pomodoroTimer');
        if (el) el.textContent = '25:00';
    };

    function updatePomodoroUI() {
        const el = document.getElementById('pomodoroTimer');
        if (!el) return;
        const m = Math.floor(Features.pomodoroRemaining / 60);
        const s = Features.pomodoroRemaining % 60;
        el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function bindFocusMode() {
        const focusTitle = document.getElementById('focusTitle');
        const focusBody = document.getElementById('focusBody');

        document.getElementById('focusExit').addEventListener('click', Features.exitFocusMode);

        // Instant autosave while writing in focus mode (debounced)
        const focusAutosave = Utils.debounce(() => {
            const id = Features.focusNoteId;
            if (!id) return;
            const note = State.getNote(id);
            if (!note) return;
            note.title = focusTitle.value.trim();
            note.updatedAt = Date.now();
            const html = focusBody.innerHTML;
            DB.setContent(id, html).then(() => {
                if (App.getNoteTextPreview) App.invalidatePreview(id);
            }).catch(() => {});
            State.save();
            App.renderSidebar();
        }, 350);

        focusBody.addEventListener('input', Utils.debounce(() => {
            handleFocusLinkTyping();
            focusBody.querySelectorAll('.checklist-item').forEach((li) => {
                const box = li.querySelector('input');
                li.classList.toggle('checked', box && box.checked);
            });
            focusAutosave();
        }, 200));

        focusTitle.addEventListener('input', focusAutosave);

        // Checklist + internal link interaction in focus mode
        focusBody.addEventListener('click', (e) => {
            if (e.target.matches('.checklist-item input')) {
                const li = e.target.closest('.checklist-item');
                li.classList.toggle('checked', e.target.checked);
                focusAutosave();
                return;
            }
            if (e.target.matches('.internal-link')) {
                const title = e.target.dataset.title;
                const linkId = e.target.dataset.note;
                let target = linkId ? State.getNote(linkId) : null;
                if (!target) {
                    target = App.createNote({ title: title, content: '', returnContent: false });
                    toast('Note created: ' + title, 'success');
                    // Point any unresolved spans to the created note before saving
                    focusBody.querySelectorAll('.internal-link[data-note=""]').forEach((sp) => {
                        if (sp.dataset.title === title) sp.dataset.note = target.id;
                    });
                }
                Features.exitFocusMode();
                App.openEditor(target.id);
            }
        });

        const darkToggle = document.getElementById('focusDarkToggle');
        darkToggle.addEventListener('click', () => {
            const mode = document.getElementById('focusMode');
            const cur = mode.dataset.bg;
            if (cur === 'dark') {
                mode.dataset.bg = 'light';
                mode.style.background = '#e9e9f0';
                document.getElementById('focusTitle').style.color = '#1a1a2e';
                document.getElementById('focusBody').style.color = '#333';
            } else {
                mode.dataset.bg = 'dark';
                mode.style.background = '#0d0d1a';
                document.getElementById('focusTitle').style.color = '#eaeaf0';
                document.getElementById('focusBody').style.color = '#c0c0d0';
            }
        });

        document.getElementById('pomodoroToggle').addEventListener('click', () => {
            const controls = document.getElementById('pomodoroControls');
            controls.style.display = controls.style.display === 'flex' ? 'none' : 'flex';
        });
        document.getElementById('pomodoroStart').addEventListener('click', (e) => {
            e.stopPropagation();
            if (Features.pomodoroRunning) Features.pausePomodoro();
            else Features.startPomodoro(Number(document.getElementById('pomodoroDuration').value) * 60);
            togglePlayIcon();
        });
        document.getElementById('pomodoroReset').addEventListener('click', () => Features.resetPomodoro());
    }

    function togglePlayIcon() {
        const btn = document.getElementById('pomodoroStart');
        btn.innerHTML = Features.pomodoroRunning ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    }

    function handleFocusLinkTyping() {
        const body = document.getElementById('focusBody');
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) {
            if (/\[\[.*?\]\]/.test(walker.currentNode.textContent)) textNodes.push(walker.currentNode);
        }
        textNodes.forEach((textNode) => {
            if (!textNode.isConnected) return;
            const text = textNode.textContent;
            const m = text.match(/\[\[([^\]]+)\]\]/);
            if (m) {
                const title = m[1].trim();
                const target = State.liveNotes().find((n) => (n.title || '').toLowerCase() === title.toLowerCase());
                const link = document.createElement('span');
                link.className = 'internal-link';
                link.dataset.note = target ? target.id : '';
                link.dataset.title = title;
                link.textContent = title;
                const range = document.createRange();
                const start = text.indexOf(m[0]);
                try {
                    range.setStart(textNode, start);
                    range.setEnd(textNode, start + m[0].length);
                    range.deleteContents();
                    range.insertNode(link);
                } catch (e) {}
            }
        });
    }

    /* ============================================
       Templates
       ============================================ */
    Features.pickTemplate = function () {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        const defs = [
            { key: '__plain', icon: 'fa-file', name: 'Blank note' },
            { key: 'meeting', icon: 'fa-handshake', name: 'Meeting' },
            { key: 'project', icon: 'fa-diagram-project', name: 'Project' },
            { key: 'journal', icon: 'fa-book', name: 'Daily Journal' },
            { key: 'study', icon: 'fa-graduation-cap', name: 'Study Notes' },
            { key: 'todo', icon: 'fa-list-check', name: 'To-Do List' },
            { key: 'brainstorm', icon: 'fa-lightbulb', name: 'Brainstorming' }
        ];
        let items = defs.map((d) =>
            `<div class="command-item" data-key="${d.key}"><i class="fas ${d.icon}"></i><span>${Utils.escapeHtml(d.name)}</span></div>`
        ).join('');
        if (State.templates.length) {
            items += '<div style="padding:8px 12px;font-size:.75rem;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;">Custom</div>';
            State.templates.forEach((t) => {
                items += `<div class="command-item" data-key="${t.id}"><i class="fas fa-gem"></i><span>${Utils.escapeHtml(t.name)}</span></div>`;
            });
        }
        modal.innerHTML = `
            <div class="command-palette" style="width:90%;max-width:360px;background:var(--bg-primary);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);overflow:hidden;animation:slideUp .15s ease;">
                <div class="command-input-wrap" style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;">
                    <i class="fas fa-copy" style="color:var(--text-tertiary);"></i>
                    <span style="font-weight:600;">New note from template</span>
                </div>
                <div class="command-list" style="padding:6px;">${items}</div>
            </div>`;
        modal.addEventListener('click', (e) => {
            const item = e.target.closest('[data-key]');
            if (item) { modal.remove(); Features.createFromTemplate(item.dataset.key); }
            else if (e.target === modal) modal.remove();
        });
        document.body.appendChild(modal);
    };

    App.renderTemplates = function () {
        const builtin = document.getElementById('templatesGrid');
        const custom = document.getElementById('customTemplatesList');
        builtin.innerHTML = '';
        custom.innerHTML = '';

        const defs = [
            { key: 'meeting', icon: 'fa-handshake', name: 'Meeting', desc: 'Agenda, attendees, and action items.' },
            { key: 'project', icon: 'fa-diagram-project', name: 'Project', desc: 'Track goals, milestones, and risks.' },
            { key: 'journal', icon: 'fa-book', name: 'Daily Journal', desc: 'Capture today\'s thoughts and feelings.' },
            { key: 'study', icon: 'fa-graduation-cap', name: 'Study Notes', desc: 'Organize subjects, topics, and summaries.' },
            { key: 'todo', icon: 'fa-list-check', name: 'To-Do List', desc: 'Checklist-based task tracker.' },
            { key: 'brainstorm', icon: 'fa-lightbulb', name: 'Brainstorming', desc: 'Free-form idea harvesting.' }
        ];
        defs.forEach((d) => {
            builtin.appendChild(buildTemplateCard(d.icon, d.name, d.desc, () => {
                App.createNote({ title: d.name + ' Notes', content: getTemplateContent(d.key) });
            }));
        });

        State.templates.forEach((t) => {
            custom.appendChild(buildTemplateCard('fa-gem', t.name, 'Custom template', async () => {
                const html = await DB.getContent(t.id);
                App.createNote({ title: t.name, content: html });
            }, true));
        });
        if (!State.templates.length) {
            custom.innerHTML = '<p style="color:var(--text-tertiary);font-size:.9rem;">No custom templates yet. Open a note → ⋮ → Save as Template.</p>';
        }
    };

    function buildTemplateCard(icon, name, desc, onClick) {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.innerHTML = `
            <div class="template-icon"><i class="fas ${icon}"></i></div>
            <div class="template-name">${Utils.escapeHtml(name)}</div>
            <div class="template-desc">${Utils.escapeHtml(desc)}</div>`;
        card.addEventListener('click', onClick);
        return card;
    }

    function getTemplateContent(key) {
        const templates = {
            meeting: `<h2><b>Meeting Notes</b></h2>
<blockquote>Use this template for your next meeting.</blockquote>
<h3>Attendees</h3>
<ul><li>List attendees here</li></ul>
<h3>Agenda</h3>
<ul><li>Agenda item 1</li><li>Agenda item 2</li></ul>
<h3>Action Items</h3>
<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span>First action</span></li></ul>`,
            project: `<h2><b>Project Plan</b></h2>
<p>Describe your project in one sentence.</p>
<h3>Goals</h3>
<ul><li>Goal 1</li><li>Goal 2</li></ul>
<h3>Milestones</h3>
<ol><li>Milestone 1</li><li>Milestone 2</li></ol>
<h3>Risks</h3>
<ul><li>Potential risk</li></ul>`,
            journal: `<h2>Daily Journal</h2>
<p>How was your day? Write freely...</p>
<h3>What went well</h3>
<p>...</p>
<h3>What could improve</h3>
<p>...</p>
<h3>Gratitude</h3>
<ul><li>I am grateful for...</li></ul>`,
            study: `<h2><b>Study Notes</b></h2>
<h3>Subject:</h3>
<p>Write down the topic.</p>
<blockquote>Key concept</blockquote>
<h3>Summary</h3>
<p>Summarize what you learned.</p>
<h3>Questions</h3>
<ul><li>Question 1</li><li>Question 2</li></ul>`,
            todo: `<ul class="checklist">
<li class="checklist-item"><input type="checkbox"><span>Task 1</span></li>
<li class="checklist-item"><input type="checkbox"><span>Task 2</span></li>
<li class="checklist-item"><input type="checkbox"><span>Task 3</span></li>
</ul>`,
            brainstorm: `<h2><b>Brainstorming</b></h2>
<p>Dump all your ideas here without judgment...</p>
<ul><li>Idea 1</li><li>Idea 2</li><li>Idea 3</li></ul>
<blockquote>One insight worth remembering</blockquote>`
        };
        // fix checklist template format for meeting
        return templates[key] || `<p>New note</p>`;
    }

    App.saveNoteAsTemplate = async function () {
        const note = State.getNote(App.currentNoteId);
        if (!note) return;
        const name = prompt('Template name:', note.title || 'My Template');
        if (!name || !name.trim()) return;
        const html = App.els.editorBody.innerHTML;
        const tid = Utils.uid();
        State.templates.push({ id: tid, name: name.trim(), noteId: note.id, createdAt: Date.now() });
        await DB.setContent(tid, html);
        State.save();
        toast('Saved as template', 'success');
    };

    /* Create-from-template: kindOrId = builtin key | custom template id | '__plain' */
    Features.createFromTemplate = async function (kindOrId) {
        let content = '', title = '';
        if (kindOrId !== '__plain') {
            const custom = State.getTemplate(kindOrId);
            if (custom) {
                content = await DB.getContent(kindOrId);
                title = custom.name;
            } else {
                content = getTemplateContent(kindOrId);
                const names = { meeting: 'Meeting Notes', project: 'Project Notes', journal: 'Journal', study: 'Study Notes', todo: 'To-Do List', brainstorm: 'Brainstorming' };
                title = names[kindOrId] || 'New Notes';
            }
        }
        App.createNote({ title, content });
    };

    Features.renderTemplateMenu = function () {
        const menu = document.getElementById('templateDropdown');
        if (!menu) return;
        const defs = [
            { key: 'meeting', icon: 'fa-handshake', name: 'Meeting' },
            { key: 'project', icon: 'fa-diagram-project', name: 'Project' },
            { key: 'journal', icon: 'fa-book', name: 'Daily Journal' },
            { key: 'study', icon: 'fa-graduation-cap', name: 'Study Notes' },
            { key: 'todo', icon: 'fa-list-check', name: 'To-Do List' },
            { key: 'brainstorm', icon: 'fa-lightbulb', name: 'Brainstorming' }
        ];
        let html = '<div class="td-header"><i class="fas fa-copy"></i> Start from template</div>';
        html += '<div class="td-item" data-key="__plain"><i class="fas fa-file"></i> Blank note</div>';
        defs.forEach((d) => {
            html += `<div class="td-item" data-key="${d.key}"><i class="fas ${d.icon}"></i> ${Utils.escapeHtml(d.name)}</div>`;
        });
        if (State.templates.length) {
            html += '<div class="td-header"><i class="fas fa-gem"></i> Custom</div>';
            State.templates.forEach((t) => {
                html += `<div class="td-item" data-key="${t.id}"><i class="fas fa-gem"></i> ${Utils.escapeHtml(t.name)}</div>`;
            });
        }
        menu.innerHTML = html;
    };

    /* ============================================
       Tag Manager
       ============================================ */
    App.renderTagManager = function () {
        const container = document.getElementById('tagManagerList');
        container.innerHTML = '';
        if (!State.tags.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-tags"></i><p>No tags yet. Add tags to your notes to organize them.</p></div>';
            return;
        }
        State.tags.forEach((tag) => {
            const count = State.liveNotes().filter((n) => (n.tags || []).includes(tag.id)).length;
            const item = document.createElement('div');
            item.className = 'tag-manager-item';
            const color = prompt_color(tag.color) || tag.color;
            item.innerHTML = `
                <span class="tag-dot" style="background:${Utils.escapeHtml(color)}"></span>
                <div class="tag-info">
                    <div class="tag-name">#${Utils.escapeHtml(tag.name)}</div>
                    <div class="tag-count">${count} notes</div>
                </div>
                <div class="tag-actions">
                    <button class="icon-btn" data-act="color" title="Change Color"><i class="fas fa-palette"></i></button>
                    <button class="icon-btn" data-act="rename" title="Rename"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn" data-act="delete" title="Delete"><i class="fas fa-trash"></i></button>
                </div>`;
            item.querySelector('[data-act="color"]').addEventListener('click', () => changeTagColor(tag));
            item.querySelector('[data-act="rename"]').addEventListener('click', () => renameTag(tag));
            item.querySelector('[data-act="delete"]').addEventListener('click', () => deleteTag(tag));
            container.appendChild(item);
        });
    };

    function prompt_color(color) { return color; }

    function changeTagColor(tag) {
        const colors = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#FDCB6E', '#E84393', '#00CEC9', '#A29BFE'];
        const cur = prompt('Choose a color code (e.g. #6C5CE7):', tag.color);
        if (!cur || !cur.trim()) return;
        tag.color = cur.trim();
        State.save();
        App.renderTagManager();
        App.renderSidebar();
        App.renderNoteTags();
        toast('Tag color updated', 'success');
    }

    async function renameTag(tag) {
        const name = prompt('New tag name:', tag.name);
        if (!name || !name.trim()) return;
        tag.name = name.trim();
        State.save();
        App.renderTagManager();
        App.renderSidebar();
        App.renderNoteTags();
        toast('Tag renamed', 'success');
    }

    async function deleteTag(tag) {
        const ok = await confirmDialog(`Delete tag "#${tag.name}" from all notes?`, 'Delete');
        if (!ok) return;
        State.notes.forEach((n) => {
            n.tags = (n.tags || []).filter((x) => x !== tag.id);
        });
        State.tags = State.tags.filter((x) => x.id !== tag.id);
        State.save();
        App.renderTagManager();
        App.renderSidebar();
        App.renderNoteTags();
        App.renderNotes();
        toast('Tag deleted', 'success');
    }

    /* ============================================
       Trash
       ============================================ */
    App.renderTrash = function () {
        const list = document.getElementById('trashList');
        const empty = document.getElementById('trashEmpty');
        const trashed = State.notes.filter((n) => n.deletedAt);
        list.innerHTML = '';
        if (!trashed.length) { empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        trashed.sort((a, b) => b.deletedAt - a.deletedAt);
        trashed.forEach((n) => {
            const item = document.createElement('div');
            item.className = 'trash-item';
            item.innerHTML = `
                <i class="fas fa-file-alt" style="color:var(--text-tertiary);"></i>
                <div class="trash-info">
                    <div class="trash-title">${Utils.escapeHtml(n.title || 'Untitled')}</div>
                    <div class="trash-date">Deleted ${Utils.timeAgo(n.deletedAt)}</div>
                </div>
                <div class="trash-actions">
                    <button class="secondary-btn restore-btn"><i class="fas fa-undo"></i> ${App.T('restore')}</button>
                    <button class="danger-btn purge-btn"><i class="fas fa-times"></i></button>
                </div>`;
            item.querySelector('.restore-btn').addEventListener('click', () => App.restoreNote(n.id));
            item.querySelector('.purge-btn').addEventListener('click', () => App.purgeNote(n.id));
            list.appendChild(item);
        });
    };

    /* ============================================
       Dashboard
       ============================================ */
    App.renderDashboard = async function () {
        const live = State.liveNotes();
        document.getElementById('dashTotalNotes').textContent = live.length;
        document.getElementById('dashTotalFolders').textContent = State.folders.length;

        let totalWords = 0;
        let completedTasks = 0;
        const recent = [...live].sort((a, b) => b.updatedAt - a.updatedAt);
        const tagUsage = {};
        const contents = await Promise.all(live.map(async (n) => ({ n, html: await DB.getContent(n.id) })));
        contents.forEach(({ n, html }) => {
            const text = Utils.stripHtml(html);
            totalWords += Utils.wordCount(text);
            // count tasks
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const boxes = tmp.querySelectorAll('.checklist-item input[type="checkbox"]');
            completedTasks += [...boxes].filter((b) => b.checked).length;
            (n.tags || []).forEach((tid) => { tagUsage[tid] = (tagUsage[tid] || 0) + 1; });
        });
        document.getElementById('dashTotalWords').textContent = totalWords.toLocaleString();
        document.getElementById('dashCompletedTasks').textContent = completedTasks;

        // recently opened
        const openedBox = document.getElementById('dashRecentOpened');
        openedBox.innerHTML = '';
        const opened = [...live].filter((n) => n.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 8);
        opened.forEach((n) => {
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<i class="far fa-clock" style="color:var(--text-secondary);"></i> ${Utils.escapeHtml(n.title || 'Untitled')}<span style="margin-left:auto;font-size:.75rem;color:var(--text-tertiary);">${Utils.timeAgo(n.lastOpenedAt)}</span>`;
            el.addEventListener('click', () => App.openEditor(n.id));
            openedBox.appendChild(el);
        });
        if (!opened.length) openedBox.innerHTML = '<p style="color:var(--text-tertiary);font-size:.9rem;">No notes opened yet.</p>';

        // recent notes
        const recentBox = document.getElementById('dashRecentNotes');
        recentBox.innerHTML = '';
        recent.slice(0, 8).forEach((n) => {
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<i class="fas fa-file-alt" style="color:var(--text-secondary);"></i> ${Utils.escapeHtml(n.title || 'Untitled')}<span style="margin-left:auto;font-size:.75rem;color:var(--text-tertiary);">${Utils.timeAgo(n.updatedAt)}</span>`;
            el.addEventListener('click', () => App.openEditor(n.id));
            recentBox.appendChild(el);
        });
        if (!recent.length) recentBox.innerHTML = '<p style="color:var(--text-tertiary);font-size:.9rem;">No notes yet.</p>';

        // top tags
        const topBox = document.getElementById('dashTopTags');
        topBox.innerHTML = '';
        const sortedTags = Object.entries(tagUsage).sort((a, b) => b[1] - a[1]);
        sortedTags.slice(0, 8).forEach(([tid, count]) => {
            const tag = State.getTag(tid);
            if (!tag) return;
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<span class="tag-dot" style="width:10px;height:10px;border-radius:50%;background:${Utils.escapeHtml(tag.color)};display:inline-block;"></span> #${Utils.escapeHtml(tag.name)}<span style="margin-left:auto;font-size:.75rem;color:var(--text-tertiary);">${count}</span>`;
            topBox.appendChild(el);
        });
        if (!sortedTags.length) topBox.innerHTML = '<p style="color:var(--text-tertiary);font-size:.9rem;">No tags yet.</p>';

        // pinned & favorites
        const pinBox = document.getElementById('dashPinnedFavs');
        pinBox.innerHTML = '';
        const pf = live.filter((n) => n.isPinned || n.isFavorite).sort((a, b) => b.isPinned - a.isPinned);
        pf.slice(0, 8).forEach((n) => {
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<i class="fas ${n.isPinned ? 'fa-thumbtack' : 'fa-star'}" style="color:var(--warning);font-size:.8rem;"></i> ${Utils.escapeHtml(n.title || 'Untitled')}`;
            el.addEventListener('click', () => App.openEditor(n.id));
            pinBox.appendChild(el);
        });
        if (!pf.length) pinBox.innerHTML = '<p style="color:var(--text-tertiary);font-size:.9rem;">Pin or favorite a note to see it here.</p>';
    };

    /* ============================================
       Calendar
       ============================================ */
    App.renderCalendar = function () {
        const grid = document.getElementById('calendarGrid');
        const monthYear = document.getElementById('calMonthYear');
        const firstDay = new Date(Features.calYear, Features.calMonth, 1);
        const startDow = (firstDay.getDay() + 6) % 7; // Monday first
        const daysInMonth = new Date(Features.calYear, Features.calMonth + 1, 0).getDate();
        const today = new Date();

        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        monthYear.textContent = months[Features.calMonth] + ' ' + Features.calYear;

        grid.innerHTML = '';
        ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach((d) => {
            grid.innerHTML += `<div class="cal-header">${d}</div>`;
        });

        // notes by date
        const notesByDate = {};
        State.liveNotes().forEach((n) => {
            const d = new Date(n.updatedAt);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            (notesByDate[key] = notesByDate[key] || []).push(n);
        });

        for (let i = 0; i < startDow; i++) grid.innerHTML += '<div class="cal-day other-month"></div>';

        for (let day = 1; day <= daysInMonth; day++) {
            const key = `${Features.calYear}-${Features.calMonth}-${day}`;
            const hasNotes = notesByDate[key] && notesByDate[key].length;
            const isToday = Features.calYear === today.getFullYear() && Features.calMonth === today.getMonth() && day === today.getDate();
            const div = document.createElement('div');
            div.className = 'cal-day' + (isToday ? ' today' : '') + (hasNotes ? ' has-notes' : '');
            div.dataset.date = `${Features.calYear}-${String(Features.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            div.innerHTML = day + (hasNotes ? '<span class="cal-dot"></span>' : '');
            div.addEventListener('click', () => selectCalDay(day));
            grid.appendChild(div);
        }
    };

    function selectCalDay(day) {
        document.querySelectorAll('.cal-day').forEach((d) => d.classList.remove('selected'));
        const key = `${Features.calYear}-${Features.calMonth}-${day}`;
        document.querySelectorAll('.cal-day').forEach((d) => {
            if (d.dataset.date === `${Features.calYear}-${String(Features.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`) {
                d.classList.add('selected');
            }
        });
        const label = document.getElementById('calSelectedDate');
        label.textContent = new Date(Features.calYear, Features.calMonth, day).toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric'
        });
        const box = document.getElementById('calDayNotes');
        box.innerHTML = '';
        const notes = State.liveNotes().filter((n) => {
            const d = new Date(n.updatedAt);
            return d.getFullYear() === Features.calYear && d.getMonth() === Features.calMonth && d.getDate() === day;
        });
        if (!notes.length) {
            box.innerHTML = '<p style="color:var(--text-tertiary);">No notes edited this day.</p>';
            return;
        }
        notes.forEach((n) => {
            const el = document.createElement('div');
            el.className = 'cal-note-item';
            el.innerHTML = `<i class="fas fa-file-alt" style="color:var(--text-tertiary);margin-right:6px;"></i> ${Utils.escapeHtml(n.title || 'Untitled')}`;
            el.addEventListener('click', () => App.openEditor(n.id));
            box.appendChild(el);
        });
    }

    /* ============================================
       Knowledge Graph
       ============================================ */
    App.renderGraph = async function () {
        const canvas = document.getElementById('graphCanvas');
        const ctx = canvas.getContext('2d');
        const notes = State.liveNotes();
        if (!notes.length) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight - 40;

        const linksMap = await App.findAllLinks();
        const nodes = notes.map((n, i) => ({
            id: n.id, title: n.title || 'Untitled',
            x: canvas.width / 2 + Math.cos((i / notes.length) * Math.PI * 2) * Math.min(canvas.width, canvas.height) * 0.3,
            y: canvas.height / 2 + Math.sin((i / notes.length) * Math.PI * 2) * Math.min(canvas.width, canvas.height) * 0.3,
            r: Math.max(10, Math.sqrt(Math.max(10, Utils.wordCount(App.getNoteTextPreview(n.id)))) * 0.8)
        }));
        const nodeMap = {};
        nodes.forEach((n) => (nodeMap[n.id] = n));
        const links = [];
        Object.entries(linksMap).forEach(([from, tos]) => {
            tos.forEach((to) => {
                if (nodeMap[to] && !links.some((l) => (l.a === from && l.b === to) || (l.a === to && l.b === from))) {
                    links.push({ a: from, b: to });
                }
            });
        });

        Features.graphNodes = nodes;
        Features.graphLinks = links;
        Features.graphZoom = 1;
        Features.graphOffset = { x: 0, y: 0 };

        const draw = () => {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.translate(canvas.width / 2 + Features.graphOffset.x, canvas.height / 2 + Features.graphOffset.y);
            ctx.scale(Features.graphZoom, Features.graphZoom);

            const cs = getComputedStyle(document.documentElement);
            const linkColor = cs.getPropertyValue('--border').trim() || '#ccc';
            const nodeColor = cs.getPropertyValue('--accent').trim() || '#6C5CE7';
            const textColor = cs.getPropertyValue('--text-primary').trim() || '#333';

            ctx.strokeStyle = linkColor;
            ctx.lineWidth = 1.5;
            links.forEach((l) => {
                const a = nodeMap[l.a], b = nodeMap[l.b];
                if (!a || !b) return;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            });

            nodes.forEach((n) => {
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                ctx.fillStyle = nodeColor;
                ctx.globalAlpha = 0.85;
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle = textColor;
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(n.title.length > 20 ? n.title.slice(0, 20) + '…' : n.title, n.x, n.y + n.r + 12);
            });
            ctx.restore();
        };

        let target = null;
        const hitTest = (mx, my) => {
            const cx = (mx - canvas.width / 2 - Features.graphOffset.x) / Features.graphZoom;
            const cy = (my - canvas.height / 2 - Features.graphOffset.y) / Features.graphZoom;
            for (const n of nodes) {
                const dx = n.x - cx, dy = n.y - cy;
                if (Math.sqrt(dx * dx + dy * dy) < Math.max(n.r + 8, 20)) return n;
            }
            return null;
        };

        canvas.onmousedown = (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            target = hitTest(mx, my);
            Features.dragging = true;
            Features.dragStart = { x: e.clientX, y: e.clientY };
        };
        canvas.onmousemove = (e) => {
            if (Features.dragging) {
                const dx = e.clientX - Features.dragStart.x;
                const dy = e.clientY - Features.dragStart.y;
                if (target) {
                    target.x += dx / Features.graphZoom;
                    target.y += dy / Features.graphZoom;
                } else {
                    Features.graphOffset.x += dx;
                    Features.graphOffset.y += dy;
                }
                Features.dragStart = { x: e.clientX, y: e.clientY };
                draw();
            }
        };
        canvas.onmouseup = () => {
            if (target && !Features.draggingMoved) {
                App.openEditor(target.id);
            }
            Features.dragging = false;
            target = null;
        };
        canvas.onclick = () => { target = null; };
        canvas.onwheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            Features.graphZoom = Math.max(0.3, Math.min(3, Features.graphZoom * delta));
            draw();
        };

        // gentle simulation for a few seconds
        let iteration = 0;
        const animate = () => {
            const repelled = false;
            nodes.forEach((n) => {
                nodes.forEach((o) => {
                    if (n === o) return;
                    const dx = n.x - o.x, dy = n.y - o.y;
                    let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
                    const force = 2000 / (dist * dist);
                    n.x += (dx / dist) * force * 0.01;
                    n.y += (dy / dist) * force * 0.01;
                });
            });
            links.forEach((l) => {
                const a = nodeMap[l.a], b = nodeMap[l.b];
                if (!a || !b) return;
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const force = (dist - 100) * 0.02;
                a.x += (dx / dist) * force;
                a.y += (dy / dist) * force;
                b.x -= (dx / dist) * force;
                b.y -= (dy / dist) * force;
            });
            draw();
            iteration++;
            if (iteration < 300) requestAnimationFrame(animate);
        };
        animate();

        const resize = () => {
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight - 40;
            draw();
        };
        window.addEventListener('resize', resize);
    };

    /* ============================================
       Export / Import
       ============================================ */
    Features.exportBackup = async function () {
        const contents = await DB.getAllContent();
        const contentMap = {};
        contents.forEach((c) => (contentMap[c.id] = c.html));
        const backup = {
            app: 'mulhim',
            version: 1,
            exportedAt: new Date().toISOString(),
            data: {
                settings: State.settings,
                notes: State.notes,
                folders: State.folders,
                tags: State.tags,
                templates: State.templates,
                goals: State.goals,
                dailyIndex: State.dailyIndex
            },
            contents: contentMap
        };
        Utils.download('mulhim-backup-' + Utils.todayStr() + '.json', JSON.stringify(backup, null, 2), 'application/json');
        toast('Backup exported', 'success');
    };

    Features.importBackup = function (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const backup = JSON.parse(e.target.result);
                if (!backup.data || !Array.isArray(backup.data.notes)) {
                    throw new Error('Invalid backup file');
                }
                State.settings = Object.assign({}, State.settings, backup.data.settings);
                State.notes = backup.data.notes;
                State.folders = backup.data.folders || [];
                State.tags = backup.data.tags || [];
                State.templates = backup.data.templates || [];
                State.goals = backup.data.goals || [];
                State.dailyIndex = backup.data.dailyIndex || {};
                // write contents
                Object.entries(backup.contents || {}).forEach(([id, html]) => {
                    DB.setContent(id, html);
                });
                State.save(true);
                App.renderSidebar();
                App.showView('notes');
                toast('Backup restored successfully', 'success');
            } catch (err) {
                toast('Import failed: invalid backup file', 'error');
                console.error(err);
            }
        };
        reader.readAsText(file);
    };

    App.exportNoteAs = function (format) {
        const note = State.getNote(App.currentNoteId);
        if (!note) return;
        DB.getContent(note.id).then((html) => {
            const title = (note.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '_');
            if (format === 'txt') {
                Utils.download(title + '.txt', Utils.stripHtml(html), 'text/plain');
            } else if (format === 'md') {
                Utils.download(title + '.md', htmlToMarkdown(html), 'text/markdown');
            } else if (format === 'html') {
                Utils.download(title + '.html', htmlToHtmlFile(note.title, html), 'text/html');
            }
            toast('Exported as .' + format, 'success');
        });
    };

    function htmlToMarkdown(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        let md = '';
        const walk = (nodes) => {
            nodes.forEach((el) => {
                if (el.nodeType === 3) { md += el.textContent; return; }
                const tag = el.tagName.toLowerCase();
                if (tag === 'h1') { md += '\n# ' + el.textContent.trim() + '\n\n'; }
                else if (tag === 'h2') { md += '\n## ' + el.textContent.trim() + '\n\n'; }
                else if (tag === 'h3') { md += '\n### ' + el.textContent.trim() + '\n\n'; }
                else if (tag === 'blockquote') { md += '\n> ' + el.textContent.trim() + '\n\n'; }
                else if (tag === 'pre') { md += '\n```\n' + el.textContent + '\n```\n\n'; }
                else if (tag === 'hr') { md += '\n---\n'; }
                else if (tag === 'li') {
                    if (el.classList.contains('checklist-item')) {
                        const box = el.querySelector('input');
                        md += '- ' + (box && box.checked ? '[x] ' : '[ ] ') + el.textContent.trim() + '\n';
                    } else {
                        md += '- ' + el.textContent.trim() + '\n';
                    }
                }
                else if (tag === 'p' || tag === 'div') { md += el.textContent + '\n\n'; }
                else if (tag === 'table') {
                    el.querySelectorAll('tr').forEach((tr) => {
                        const cells = [...tr.querySelectorAll('th,td')].map((c) => c.textContent.trim());
                        md += '| ' + cells.join(' | ') + ' |\n';
                    });
                    md += '\n';
                }
                else if (tag === 'img') { md += '![](' + (el.getAttribute('src') || '') + ')\n'; }
                else if (tag === 'b' || tag === 'strong') md += '**' + el.textContent + '**';
                else if (tag === 'i' || tag === 'em') md += '*' + el.textContent + '*';
                else if (tag === 'a') md += '[' + el.textContent + '](' + (el.getAttribute('href') || '') + ')';
                else walk(el.childNodes);
            });
        };
        walk(tmp.childNodes);
        return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    function htmlToHtmlFile(title, html) {
        const fg = getComputedStyle(document.body).color;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${Utils.escapeHtml(title)}</title>
<style>body{max-width:720px;margin:40px auto;padding:0 20px;font-family:'Segoe UI',Inter,sans-serif;line-height:1.8;color:#333;}img{max-width:100%}blockquote{border-left:3px solid #6C5CE7;padding:8px 16px;background:#f0edff;margin:8px 0;}pre{background:#f4f4f6;padding:16px;border-radius:8px;overflow-x:auto;}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px 12px}</style></head>
<body>${html}</body></html>`;
    }

    /* ============================================
       Daily Note
       ============================================ */
    App.openDailyNote = function () {
        const todayStr = Utils.todayStr();
        let noteId = State.dailyIndex[todayStr];
        let note = noteId ? State.getNote(noteId) : null;
        if (!note) {
            const title = new Date().toLocaleDateString(State.settings.lang === 'ar' ? 'ar' : 'en', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            note = App.createNote({ title, returnContent: false });
            note.tags = [App.createTag('journal')];
            State.dailyIndex[todayStr] = note.id;
            State.save();
            App.renderSidebar();
        }
        App.openEditor(note.id);
    };

    /* ============================================
       Export wiring exposed
       ============================================ */
    Features.exportNoteAs = App.exportNoteAs;

    /* Expose for wiring file */
    window.Mulhim.Features = Features;
    window.Mulhim.Features.bindToolbar = bindToolbar;
    window.Mulhim.Features.bindEditorEvents = bindEditorEvents;
    window.Mulhim.Features.bindSearch = bindSearch;
    window.Mulhim.Features.bindCommandPalette = bindCommandPalette;
    window.Mulhim.Features.bindFocusMode = bindFocusMode;
    window.Mulhim.Features.populateSearchFilters = populateSearchFilters;
    window.Mulhim.Features.runSearch = runSearch;
    window.Mulhim.Features.getTemplateContent = getTemplateContent;
})();