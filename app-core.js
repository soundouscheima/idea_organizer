/* ============================================
   Mulhim — Core Application (loads after storage.js)
   State, routing, sidebar, notes CRUD, editor.
   ============================================ */
(function () {
    'use strict';
    const { Utils, DB, State, toast, confirmDialog, i18n } = window.Mulhim;

    // Translation helper delegating to the centralized bilingual dictionary
    const T = (key, params) => i18n.t(key, params);

    // Notes listing based on sidebar filters (data-view)
    const App = {
        T,
        currentView: 'notes',
        currentFolder: null,
        currentTag: null,
        currentNoteId: null,
        selectedNoteIds: new Set(),
        searchTermColumn: null,
        _currentSort: 'updatedAt',
        _editorLoadToken: 0,

        // DOM refs
        els: {},

        elsGet() {
            const ids = ['sidebar','mainContent','notesContainer','emptyState','noteCount','favCount','trashCount',
                'folderTree','sidebarTagList','breadcrumb','editorView','notesView','searchView','dashboardView',
                'tagManagerView','trashView','templatesView','calendarView','graphView','noteTitle','noteTags',
                'editorBody','saveStatus','noteDate','noteWordCount','noteReadTime','taskProgress','progressFill',
                'progressText','noteFavoriteBtn','notePinBtn','noteMenu','imageUploadInput'];
            const els = {};
            ids.forEach((id) => (els[id] = document.getElementById(id)));
            return els;
        }
    };

    window.Mulhim.App = App;

    /* ============================================
       View Routing
       ============================================ */
    App.showView = function (view, opts) {
        opts = opts || {};
        if (view === 'daily') { App.openDailyNote(); return; }
        App.currentView = view;
        App.selectedNoteIds.clear();
        App.updateBulkBar();

        const views = ['search','dashboard','tagManager','trash','templates','calendar','graph','tasks','goals','archive','recent','stats'];
        views.forEach((v) => {
            const el = document.getElementById(v + 'View');
            if (!el) return;
            el.classList.toggle('active', v === view);
            el.style.display = view === v ? '' : 'none';
        });
        // notesView handles notes + favorites
        const nv = App.els.notesView;
        const isNotes = view === 'notes' || view === 'favorites';
        nv.classList.toggle('active', isNotes);
        nv.style.display = isNotes ? '' : 'none';
        // editor handled separately
        const ev = App.els.editorView;
        ev.classList.toggle('active', view === 'editor');
        if (view === 'editor') {
            ev.style.display = 'flex';
        } else {
            ev.style.display = 'none';
        }

        // Sidebar active states
        document.querySelectorAll('.nav-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.view === view && view !== 'editor');
        });
        document.querySelectorAll('.folder-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.folderId === App.currentFolder && view === 'notes');
        });

        // Route specific render
        if (view === 'notes') App.renderNotes();
        else if (view === 'favorites') App.renderNotes('favorites');
        else if (view === 'dashboard') App.renderDashboard();
        else if (view === 'tagManager') App.renderTagManager();
        else if (view === 'trash') App.renderTrash();
        else if (view === 'templates') App.renderTemplates();
        else if (view === 'calendar') App.renderCalendar();
        else if (view === 'graph') App.renderGraph();
        else if (view === 'tasks') App.renderTasks();
        else if (view === 'goals') App.renderGoals();
        else if (view === 'archive') App.renderArchive();
        else if (view === 'recent') App.renderRecent();
        else if (view === 'stats') App.renderStats();
        else if (view === 'search') document.getElementById('searchInput').focus();

        // Breadcrumb
        const bc = App.els.breadcrumb;
        const viewLabels = {
            notes: 'allNotes', favorites: 'favorites', daily: 'daily', trash: 'trash',
            templates: 'templates', tagManager: 'tagManager', dashboard: 'dashboard',
            calendar: 'calendar', graph: 'graph', search: 'search',
            tasks: 'tasks', goals: 'goals', archive: 'archive', recent: 'recent', stats: 'stats'
        };
        let labelKey = viewLabels[view] || 'allNotes';
        let label = T(labelKey);
        if (view === 'editor') {
            const note = State.getNote(App.currentNoteId);
            label = note ? note.title || T('untitled') : '';
        } else if (view === 'notes' && App.currentFolder) {
            label = App.folderPathName(App.currentFolder);
        }
        bc.innerHTML = `<span class="breadcrumb-item">${Utils.escapeHtml(label)}</span>`;
    };

    App.folderPathName = function (folderId) {
        const parts = [];
        let f = State.getFolder(folderId);
        while (f) {
            parts.unshift(f.name);
            f = f.parentId ? State.getFolder(f.parentId) : null;
        }
        return parts.join(' / ');
    };

    /* ============================================
       Sidebar Rendering
       ============================================ */
    App.renderSidebar = function () {
        const live = State.liveNotes();
        App.els.noteCount.textContent = live.length;
        App.els.favCount.textContent = live.filter((n) => n.isFavorite).length;
        App.els.trashCount.textContent = State.notes.filter((n) => n.deletedAt).length;
        const archEl = document.getElementById('archiveCount');
        if (archEl) archEl.textContent = State.notes.filter((n) => n.isArchived && !n.deletedAt).length;
        const profEl = document.getElementById('profileNameDisplay');
        if (profEl) profEl.textContent = State.settings.profileName || i18n.t('appName');

        App.renderFolderTree();
        App.renderSidebarTags();
        App.applySettings();
    };

    App.renderFolderTree = function () {
        const container = App.els.folderTree;
        const rootFolders = State.folders.filter((f) => !f.parentId);
        const renderRec = (folder, depth) => {
            const children = State.folderChildren(folder.id);
            const count = new Set(State.allFolderIds(folder.id).flatMap((id) => State.folderNotes(id).map((n) => n.id))).size;
            const div = document.createElement('div');
            div.className = 'folder-item' + (depth > 0 ? ' subfolder' : '');
            div.dataset.folderId = folder.id;
            div.style.paddingLeft = (12 + depth * 14) + 'px';
            const color = folder.color || '#6C5CE7';
            div.innerHTML = `
                <span class="folder-dot" style="background:${Utils.escapeHtml(color)}"></span>
                <i class="fas fa-folder folder-icon"></i>
                <span class="folder-name">${Utils.escapeHtml(folder.name)}</span>
                <span class="folder-count">${count}</span>
                <span class="folder-actions">
                    <button class="icon-btn rename-folder" title="Rename"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn delete-folder" title="Delete"><i class="fas fa-trash"></i></button>
                </span>`;
            if (App.currentFolder === folder.id) div.classList.add('active');
            div.addEventListener('click', (e) => {
                if (e.target.closest('.folder-actions')) return;
                App.currentFolder = App.currentFolder === folder.id ? null : folder.id;
                App.currentTag = null;
                App.showView('notes');
            });
            div.addEventListener('dragover', (e) => { e.preventDefault(); div.classList.add('drag-over'); });
            div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
            div.addEventListener('drop', (e) => {
                e.preventDefault();
                div.classList.remove('drag-over');
                const noteId = e.dataTransfer.getData('text/note-id');
                const folderId = e.dataTransfer.getData('text/folder-id');
                if (noteId) App.moveNoteToFolder(noteId, folder.id);
                else if (folderId) App.moveFolderTo(folderId, folder.parentId === folder.id ? null : folder.id);
            });
            div.querySelector('.rename-folder').addEventListener('click', () => App.promptFolderRename(folder));
            div.querySelector('.delete-folder').addEventListener('click', () => App.deleteFolder(folder.id));
            container.appendChild(div);
            children.forEach((c) => renderRec(c, depth + 1));
        };
        container.innerHTML = '';
        rootFolders.forEach((f) => renderRec(f, 0));

        // Uncategorized pseudo-folder
        const uncounted = State.liveNotes().filter((n) => !n.folderId).length;
        const un = document.createElement('div');
        un.className = 'folder-item' + (App.currentFolder === '__none__' ? ' active' : '');
        un.dataset.folderId = '__none__';
        un.style.paddingLeft = '12px';
        un.style.color = 'var(--text-tertiary)';
        un.innerHTML = `
            <span class="folder-dot" style="background:#999"></span>
            <i class="fas fa-folder-open folder-icon"></i>
            <span class="folder-name">${Utils.escapeHtml(T('uncategorized'))}</span>
            <span class="folder-count">${uncounted}</span>`;
        un.addEventListener('click', (e) => {
            if (e.target.closest('.folder-actions')) return;
            App.currentFolder = un.classList.contains('active') ? null : '__none__';
            App.currentTag = null;
            App.showView('notes');
        });
        container.appendChild(un);
    };

    App.renderSidebarTags = function () {
        const container = App.els.sidebarTagList;
        container.innerHTML = '';
        State.tags.forEach((tag) => {
            const count = State.liveNotes().filter((n) => (n.tags || []).includes(tag.id)).length;
            const pill = document.createElement('span');
            pill.className = 'tag-pill' + (App.currentTag === tag.id ? ' active' : '');
            pill.textContent = '#' + tag.name;
            pill.style.background = tag.color + '22';
            pill.style.color = tag.color;
            if (App.currentTag === tag.id) {
                pill.style.boxShadow = '0 0 0 2px ' + tag.color;
            }
            pill.title = count + ' notes';
            pill.addEventListener('click', () => {
                App.currentTag = App.currentTag === tag.id ? null : tag.id;
                App.currentFolder = null;
                App.showView('notes');
            });
            container.appendChild(pill);
        });
    };

    /* ============================================
       Notes Rendering (grid / list)
       ============================================ */
    App.renderNotes = function (mode) {
        App.currentView = 'notes';
        const notes = App.filterNotes(mode || 'all');
        App.renderNotesInto(notes);
    };

    App.filterNotes = function (mode) {
        let notes = State.liveNotes().slice();
        if (mode === 'favorites') notes = notes.filter((n) => n.isFavorite);
        else if (mode === 'trash') notes = notes.filter((n) => n.deletedAt);
        if (App.currentFolder === '__none__') {
            notes = notes.filter((n) => !n.folderId);
        } else if (App.currentFolder) {
            const ids = new Set(State.allFolderIds(App.currentFolder));
            notes = notes.filter((n) => ids.has(n.folderId));
        }
        if (App.currentTag) {
            notes = notes.filter((n) => (n.tags || []).includes(App.currentTag));
        }
        const sortKey = State.settings.sort || 'updatedAt';
        notes.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            if (sortKey === 'title') return (a.title || '').localeCompare(b.title || '');
            return ((b[sortKey] || 0) - (a[sortKey] || 0));
        });
        return notes;
    };

    App.renderNotesInto = function (notes) {
        const container = App.els.notesContainer;
        const isList = State.settings.view === 'list';
        container.className = 'notes-container' + (isList ? ' list-view' : '');
        container.innerHTML = '';

        document.getElementById('viewToggle').querySelectorAll('.view-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.view === State.settings.view);
        });
        document.querySelectorAll('.sort-option').forEach((opt) => {
            opt.classList.toggle('active', opt.dataset.sort === State.settings.sort);
        });

        if (!notes.length) {
            const empty = App.els.emptyState;
            empty.style.display = 'block';
            empty.querySelector('h3').textContent = T('noNotes');
            empty.querySelector('p').textContent = T('createFirst');
            container.innerHTML = '';
            return;
        }
        App.els.emptyState.style.display = 'none';

        notes.forEach((note) => {
            container.appendChild(App.buildNoteCard(note));
        });
    };

    App.buildNoteCard = function (note) {
        const card = document.createElement('div');
        card.className = 'note-card' + (note.isPinned ? ' pinned' : '') + (App.selectedNoteIds.has(note.id) ? ' selected' : '') + (note.hidden ? ' blurred' : '');
        card.dataset.noteId = note.id;
        card.draggable = true;

        const tags = State.noteTags(note);
        const tagHtml = tags.map((t) =>
            `<span class="mini-tag" style="background:${Utils.escapeHtml(t.color)}22;color:${Utils.escapeHtml(t.color)}">#${Utils.escapeHtml(t.name)}</span>`
        ).join('');

        card.innerHTML = `
            ${note.isFavorite ? '<i class="fas fa-star card-star" style="position:absolute;top:14px;right:14px;color:var(--warning);"></i>' : ''}
            ${note.hidden ? '<i class="fas fa-eye-slash card-hidden-icon" style="position:absolute;top:14px;left:14px;color:var(--text-tertiary);" title="Preview blurred (visual hiding only)"></i>' : ''}
            <div class="note-card-title">${Utils.escapeHtml(note.title || T('untitled'))}</div>
            <div class="note-card-tags">${tagHtml}</div>
            <div class="note-card-preview"></div>
            <div class="note-card-footer">
                <span>${Utils.timeAgo(note.updatedAt)}</span>
                <span><i class="far fa-file-alt"></i> ${Utils.wordCount(App.getNoteTextPreview(note.id))}</span>
            </div>`;

        // Load preview from content (async, cached-ish via contentProvider)
        App.getPreviewText(note.id).then((text) => {
            if (card.isConnected) {
                card.querySelector('.note-card-preview').textContent = text;
                const footerSpan = card.querySelector('.note-card-footer span:nth-child(2)');
                if (footerSpan) footerSpan.textContent = Utils.wordCount(text) + ' ' + App.T('words');
            }
        });

        card.addEventListener('click', (e) => {
            if (e.target.closest('.note-card-actions')) return;
            App.openEditor(note.id);
        });
        card.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            App.toggleSelectNote(note.id);
        });

        // Drag start
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/note-id', note.id);
            card.classList.add('drag-ghost');
        });
        card.addEventListener('dragend', () => card.classList.remove('drag-ghost'));

        // Context menu (right-click) row actions
        const actions = document.createElement('div');
        actions.className = 'note-card-actions';
        const quickBtns = [
            { icon: 'fa-star', filled: !!note.isFavorite, act: () => App.toggleFavorite(note.id) },
            { icon: 'fa-thumbtack', filled: true, act: () => App.togglePin(note.id) }
        ];
        quickBtns.forEach((b) => {
            const btn = document.createElement('button');
            btn.innerHTML = `<i class="${b.filled ? 'fas' : 'far'} ${b.icon}"></i>`;
            if (b.icon === 'fa-star' && b.filled) btn.style.color = 'var(--warning)';
            btn.addEventListener('click', (e) => { e.stopPropagation(); b.act(); });
            actions.appendChild(btn);
        });
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            App.deleteNote(note.id);
        });
        actions.appendChild(delBtn);
        card.appendChild(actions);

        return card;
    };

    const previewCache = new Map();
    App.getNoteTextPreview = function (noteId) {
        const c = previewCache.get(noteId);
        return c !== undefined ? c : '';
    };
    App.getPreviewText = async function (noteId) {
        const html = await DB.getContent(noteId);
        const text = Utils.stripHtml(html);
        previewCache.set(noteId, text);
        return text.slice(0, 200);
    };
    App.invalidatePreview = function (noteId) {
        previewCache.delete(noteId);
    };

    App.toggleSelectNote = function (id) {
        if (App.selectedNoteIds.has(id)) App.selectedNoteIds.delete(id);
        else App.selectedNoteIds.add(id);
        App.updateBulkBar();
        const card = document.querySelector(`.note-card[data-note-id="${id}"]`);
        if (card) card.classList.toggle('selected', App.selectedNoteIds.has(id));
    };

    App.updateBulkBar = function () {
        let bar = document.getElementById('bulkBar');
        const count = App.selectedNoteIds.size;
        if (count === 0) {
            if (bar) bar.remove();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'bulkBar';
            bar.className = 'bulk-actions-bar';
            document.body.appendChild(bar);
            bar.innerHTML = `
                <span></span>
                <button class="primary-btn" data-be="move"><i class="fas fa-folder"></i> Move</button>
                <button class="secondary-btn" data-be="archive"><i class="fas fa-archive"></i> Archive</button>
                <button class="secondary-btn" data-be="tag"><i class="fas fa-tags"></i> Tag</button>
                <button class="secondary-btn" data-be="merge"><i class="fas fa-object-group"></i> Merge</button>
                <button class="danger-btn" data-be="delete"><i class="fas fa-trash"></i> Delete</button>`;
            bar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-be]');
                if (!btn) return;
                const ids = [...App.selectedNoteIds];
                if (btn.dataset.be === 'delete') {
                    App.confirmBulkDelete(ids);
                } else if (btn.dataset.be === 'archive') {
                    ids.forEach((id) => App.archiveNote(id));
                    App.selectedNoteIds.clear();
                    App.updateBulkBar();
                    App.renderSidebar();
                    App.renderNotes();
                    toast('Archived ' + ids.length + ' notes', 'success');
                } else if (btn.dataset.be === 'move') {
                    App.promptBulkMove(ids);
                } else if (btn.dataset.be === 'tag') {
                    App.promptBulkTag(ids);
                } else if (btn.dataset.be === 'merge') {
                    App.mergeNotes(ids);
                }
            });
        }
        bar.querySelector('span').textContent = count + ' selected';
    };

    App.confirmBulkDelete = async function (ids) {
        const ok = await confirmDialog('Move ' + ids.length + ' notes to trash?', 'Delete');
        if (!ok) return;
        ids.forEach((id) => App.deleteNote(id));
        App.selectedNoteIds.clear();
        App.updateBulkBar();
        App.renderSidebar();
        App.renderNotes();
        toast('Moved to trash', 'info');
    };

    App.promptBulkMove = async function (ids) {
        const resp = await App.promptFolderPicker('Move ' + ids.length + ' notes to folder');
        if (resp === null) return;
        ids.forEach((id) => {
            const n = State.getNote(id);
            if (n) { n.folderId = resp; n.updatedAt = Date.now(); }
        });
        State.save();
        App.renderSidebar();
        App.renderNotes();
        toast('Notes moved', 'success');
    };

    App.promptBulkTag = async function (ids) {
        const resp = await App.promptTagPicker('Add tag to ' + ids.length + ' notes');
        if (resp === null) return;
        ids.forEach((id) => {
            const n = State.getNote(id);
            if (n) {
                n.tags = n.tags || [];
                if (!n.tags.includes(resp)) n.tags.push(resp);
                n.updatedAt = Date.now();
            }
        });
        State.save();
        App.renderSidebar();
        App.renderNotes();
        toast('Tag added', 'success');
    };

    /* ============================================
       Notes CRUD
       ============================================ */
    App.createNote = function (opts) {
        opts = opts || {};
        const note = {
            id: Utils.uid(),
            title: opts.title || '',
            folderId: opts.folderId !== undefined ? opts.folderId : (App.currentFolder === '__none__' ? null : App.currentFolder),
            tags: opts.tags || [],
            isPinned: false,
            isFavorite: false,
            isArchived: false,
            deletedAt: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        State.notes.unshift(note);
        DB.setContent(note.id, opts.content || '').catch(() => {});
        State.save(true);
        App.renderSidebar();
        if (opts.returnContent !== false) App.openEditor(note.id, opts.selectTitle);
        return note;
    };

    App.openEditor = async function (noteId, selectTitle) {
        App.currentNoteId = noteId;
        const token = ++App._editorLoadToken;
        App.showView('editor');
        const note = State.getNote(noteId);
        if (!note) return;
        note.lastOpenedAt = Date.now();

        const html = await DB.getContent(noteId);
        if (token !== App._editorLoadToken || App.currentNoteId !== noteId) return;
        const body = App.els.editorBody;
        const editorScroll = body.closest('.editor-content');
        if (editorScroll) editorScroll.scrollTop = 0;
        body.innerHTML = App.parseInternalLinks(html);
        App.els.noteTitle.value = note.title || '';

        App.refreshEditorMeta();
        App.refreshTaskProgress();
        App.renderNoteTags();
        App.updateEditorButtons();
        App.renderBacklinks();
        App.updateHideDisclaimer();

        App.showSaveStatus('saved');
        if (selectTitle) App.els.noteTitle.focus();
        else body.focus();
    };

    App.closeEditor = function (saveContent) {
        if (saveContent) App.saveEditorContent(true);
        App.currentNoteId = null;
        App.showView('notes');
    };

    App.refreshEditorMeta = function () {
        const note = State.getNote(App.currentNoteId);
        if (!note) return;
        App.els.noteDate.textContent = Utils.formatDateTime(note.createdAt) + ' · edited ' + Utils.timeAgo(note.updatedAt);
        const text = Utils.stripHtml(App.els.editorBody.innerHTML);
        const wc = Utils.wordCount(text);
        App.els.noteWordCount.textContent = wc + ' ' + T('words');
        App.els.noteReadTime.textContent = Utils.readingTime(text) + ' ' + T('minRead');
    };

    App.refreshTaskProgress = function () {
        const body = App.els.editorBody;
        const boxes = body.querySelectorAll('.checklist-item input[type="checkbox"]');
        const total = boxes.length;
        const done = [...boxes].filter((b) => b.checked).length;
        const wrap = App.els.taskProgress;
        if (!total) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        App.els.progressFill.style.width = (total ? (done / total * 100) : 0) + '%';
        App.els.progressText.textContent = done + '/' + total + ' completed';
    };

    App.saveEditorContent = function (immediate) {
        const note = State.getNote(App.currentNoteId);
        if (!note) return;
        const body = App.els.editorBody.cloneNode(true);
        App.prepareBlocksForSave(body);
        const html = body.innerHTML;
        if (html !== App._lastSavedHtml) {
            App.showSaveStatus('saving');
            DB.setContent(note.id, html).then(() => {
                previewCache.set(note.id, Utils.stripHtml(html));
                if (App.currentNoteId === note.id) App.showSaveStatus('saved');
            }).catch(() => {
                if (App.currentNoteId === note.id) App.showSaveStatus('error');
            });
            App._lastSavedHtml = html;
        }
        note.title = App.els.noteTitle.value.trim();
        note.updatedAt = Date.now();
        State.save(immediate);
        App.updateTitleIndex(note);
        App.refreshEditorMeta();
        App.renderSidebar();
    };

    App.updateTitleIndex = function (note) {
        if (!note) return;
        const titles = document.querySelectorAll('.note-card[data-note-id]');
        titles.forEach((el) => {
            if (el.dataset.noteId === note.id) {
                const t = el.querySelector('.note-card-title');
                if (t) t.textContent = note.title || T('untitled');
            }
        });
    };

    App.showSaveStatus = function (status) {
        const el = App.els.saveStatus;
        el.className = 'save-status ' + status;
        const icon = status === 'saved' ? 'fa-check-circle' : status === 'saving' ? 'fa-spinner fa-spin' : 'fa-exclamation-circle';
        const text = status === 'saved' ? T('saved') : status === 'saving' ? T('saving') : T('saveError');
        el.innerHTML = `<i class="fas ${icon}"></i> ${text}`;
    };

    // ---------- Note actions ----------
    App.togglePin = function (id) {
        const n = State.getNote(id);
        if (n) { n.isPinned = !n.isPinned; n.updatedAt = Date.now(); }
        State.save();
        App.renderSidebar();
        App.updateEditorButtons();
        if (App.currentView === 'notes') App.renderNotes();
    };

    App.toggleFavorite = function (id) {
        const n = State.getNote(id);
        if (n) { n.isFavorite = !n.isFavorite; n.updatedAt = Date.now(); }
        State.save();
        App.renderSidebar();
        App.updateEditorButtons();
        App.renderNotes();
    };

    App.toggleNoteHide = function (id) {
        const n = State.getNote(id);
        if (!n) return;
        n.hidden = !n.hidden;
        n.updatedAt = Date.now();
        State.save();
        App.updateEditorButtons();
        App.renderNotes();
        App.updateHideDisclaimer();
        toast(n.hidden
            ? 'Preview blurred. Note: this is visual hiding only — NOT encryption or security.'
            : 'Preview unhidden', n.hidden ? 'info' : 'success');
    };

    App.updateHideDisclaimer = function () {
        let banner = document.getElementById('hideDisclaimer');
        const note = State.getNote(App.currentNoteId);
        const show = !!(note && note.hidden);
        if (!show) { if (banner) banner.style.display = 'none'; return; }
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'hideDisclaimer';
            banner.className = 'hide-disclaimer';
            const ep = App.els.editorBody ? App.els.editorBody.closest('.editor-content') : null;
            if (ep) ep.insertBefore(banner, ep.firstChild);
        }
        banner.style.display = 'block';
    };

    App.archiveNote = function (id) {
        const n = State.getNote(id);
        if (n) { n.isArchived = true; n.updatedAt = Date.now(); }
        State.save();
        App.renderSidebar();
        App.renderNotes();
    };

    App.deleteNote = async function (id) {
        const n = State.getNote(id);
        if (!n) return;
        const ok = await confirmDialog(`Delete "${n.title || 'Untitled'}"? It will go to Trash.`, 'Delete');
        if (!ok) return;
        n.deletedAt = Date.now();
        State.save();
        App.renderSidebar();
        App.renderNotes();
        App.renderTrash();
        toast('Note moved to trash', 'info');
    };

    App.restoreNote = function (id) {
        const n = State.getNote(id);
        if (n) { n.deletedAt = null; n.updatedAt = Date.now(); }
        State.save();
        App.renderSidebar();
        App.renderNotes();
        App.renderTrash();
        toast('Note restored', 'success');
    };

    App.purgeNote = async function (id) {
        const n = State.getNote(id);
        if (!n) return;
        const ok = await confirmDialog('Delete forever? This cannot be undone.', 'Delete forever');
        if (!ok) return;
        State.notes = State.notes.filter((x) => x.id !== id);
        await DB.deleteContent(id);
        previewCache.delete(id);
        State.save();
        App.renderSidebar();
        App.renderTrash();
        toast('Note permanently deleted', 'info');
    };

    App.emptyTrash = async function () {
        const count = State.notes.filter((n) => n.deletedAt).length;
        if (!count) return;
        const ok = await confirmDialog(`Permanently delete ${count} notes?`, 'Empty Trash');
        if (!ok) return;
        const purged = State.notes.filter((n) => n.deletedAt);
        purged.forEach((n) => DB.deleteContent(n.id));
        State.notes = State.notes.filter((n) => !n.deletedAt);
        State.save();
        App.renderSidebar();
        App.renderTrash();
        toast('Trash emptied', 'success');
    };

    App.duplicateNote = async function (id) {
        const src = State.getNote(id);
        if (!src) return;
        const html = await DB.getContent(id);
        const copy = App.createNote({
            title: (src.title || 'Untitled') + ' (copy)',
            folderId: src.folderId,
            tags: src.tags.slice(),
            content: html,
            returnContent: false
        });
        toast('Note duplicated', 'success');
        App.openEditor(copy.id);
    };

    App.mergeNotes = async function (ids) {
        if (ids.length < 2) { toast('Select at least 2 notes to merge', 'error'); return; }
        const ok = await confirmDialog('Merge ' + ids.length + ' notes into one? The originals will move to Trash.', 'Merge');
        if (!ok) return;
        const srcs = ids.map((id) => State.getNote(id)).filter(Boolean);
        const mergedHtml = [];
        for (const src of srcs) {
            const html = await DB.getContent(src.id);
            mergedHtml.push('<h2>' + Utils.escapeHtml(src.title || 'Untitled') + '</h2>', html);
        }
        const primary = srcs[0];
        const merged = App.createNote({
            title: (primary.title || 'Untitled') + ' (merged)',
            folderId: primary.folderId,
            tags: [...new Set(srcs.flatMap((s) => s.tags || []))],
            content: mergedHtml.join('\n'),
            returnContent: false
        });
        srcs.forEach((s) => { s.deletedAt = Date.now(); });
        App.selectedNoteIds.clear();
        App.updateBulkBar();
        State.save();
        App.renderSidebar();
        App.renderNotes();
        App.openEditor(merged.id);
        toast('Notes merged', 'success');
    };

    App.moveNoteToFolder = function (noteId, folderId) {
        const n = State.getNote(noteId);
        if (n) { n.folderId = folderId || null; n.updatedAt = Date.now(); }
        State.save();
        App.renderSidebar();
        App.renderNotes();
        toast('Note moved', 'success');
    };

    App.toggleArchiveNoteEditor = function () {
        if (!App.currentNoteId) return;
        App.archiveNote(App.currentNoteId);
        App.closeEditor();
    };

    App.updateEditorButtons = function () {
        const n = State.getNote(App.currentNoteId);
        if (!n) return;
        App.els.noteFavoriteBtn.classList.toggle('active', n.isFavorite);
        App.els.noteFavoriteBtn.innerHTML = `<i class="fas fa-star ${n.isFavorite ? '' : 'far'}"></i>`;
        App.els.notePinBtn.classList.toggle('active', n.isPinned);
    };

    App.renderNoteTags = function () {
        const n = State.getNote(App.currentNoteId);
        if (!n) return;
        const container = App.els.noteTags;
        container.innerHTML = '';
        State.noteTags(n).forEach((tag) => {
            const el = document.createElement('span');
            el.className = 'note-tag';
            el.style.background = tag.color + '22';
            el.style.color = tag.color;
            el.innerHTML = `<span>#${Utils.escapeHtml(tag.name)}</span><span class="remove-tag"><i class="fas fa-times"></i></span>`;
            el.querySelector('.remove-tag').addEventListener('click', (e) => {
                e.stopPropagation();
                n.tags = (n.tags || []).filter((x) => x !== tag.id);
                n.updatedAt = Date.now();
                State.save();
                App.renderNoteTags();
                App.renderSidebar();
            });
            container.appendChild(el);
        });
        const addBtn = document.createElement('span');
        addBtn.className = 'note-tag add-tag-btn';
        addBtn.innerHTML = '<i class="fas fa-plus"></i>';
        addBtn.style.background = 'var(--bg-tertiary)';
        addBtn.style.color = 'var(--text-secondary)';
        addBtn.addEventListener('click', () => App.promptNoteTag());
        container.appendChild(addBtn);
    };

    App.promptNoteTag = async function () {
        const tagId = await App.promptTagPicker('Add a tag');
        if (!tagId) return;
        const n = State.getNote(App.currentNoteId);
        if (n) {
            n.tags = n.tags || [];
            if (!n.tags.includes(tagId)) n.tags.push(tagId);
            n.updatedAt = Date.now();
            State.save();
            App.renderNoteTags();
            App.renderSidebar();
        }
    };

    App.promptTagPicker = function (title) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            let items = State.tags.map((t) =>
                `<div class="command-item" data-id="${t.id}" style="display:flex;align-items:center;gap:8px;">
                    <span class="tag-dot" style="width:10px;height:10px;border-radius:50%;background:${Utils.escapeHtml(t.color)};display:inline-block;"></span>
                    <span>#${Utils.escapeHtml(t.name)}</span>
                </div>`).join('');
            if (!items) items = '<div style="padding:12px;color:var(--text-tertiary);font-size:0.85rem;">No tags yet. Create one first.</div>';
            modal.innerHTML = `
                <div class="command-palette" style="width:90%;max-width:360px;background:var(--bg-primary);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);overflow:hidden;animation:slideUp .15s ease;">
                    <div class="command-input-wrap" style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;">
                        <i class="fas fa-tag" style="color:var(--text-tertiary);"></i>
                        <span style="font-weight:600;">${Utils.escapeHtml(title)}</span>
                    </div>
                    <div class="command-list" style="padding:6px;">${items}
                        <div class="command-item" data-id="__new" style="color:var(--accent);">
                            <i class="fas fa-plus"></i> Create new tag
                        </div>
                    </div>
                </div>`;
            modal.addEventListener('click', (e) => {
                const item = e.target.closest('[data-id]');
                if (!item) { if (e.target === modal) { modal.remove(); resolve(null); } return; }
                let id = item.dataset.id;
                if (id === '__new') {
                    modal.remove();
                    App.promptNewTag(title).then((newId) => resolve(newId));
                    return;
                }
                modal.remove();
                resolve(id);
            });
            document.body.appendChild(modal);
        });
    };

    App.promptNewTag = function (title) {
        return new Promise((resolve) => {
            const name = prompt('Tag name:');
            if (!name || !name.trim()) { resolve(null); return; }
            const tagId = App.createTag(name.trim());
            resolve(tagId);
        });
    };

    App.createTag = function (name, color) {
        const existing = State.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        const tag = { id: Utils.tagId(), name, color: color || '#6C5CE7', createdAt: Date.now() };
        State.tags.push(tag);
        State.save();
        App.renderSidebar();
        App.renderTagManager();
        return tag.id;
    };

    /* ============================================
       Internal Links
       ============================================ */
    App.parseInternalLinks = function (html) {
        if (!html) return html;
        return html.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
            const target = State.liveNotes().find((n) => (n.title || '').toLowerCase() === String(name).trim().toLowerCase());
            if (target) {
                return `<span class="internal-link" data-note="${target.id}" data-title="${Utils.escapeHtml(name)}">${Utils.escapeHtml(name)}</span>`;
            }
            return `<span class="internal-link" data-note="" data-title="${Utils.escapeHtml(name)}" style="opacity:.7;">${Utils.escapeHtml(name)}</span>`;
        });
    };

    App.renderBacklinks = async function () {
        const section = document.getElementById('backlinksSection');
        const list = document.getElementById('backlinksList');
        if (!App.currentNoteId) return;
        const currentId = App.currentNoteId;
        const links = await App.findAllLinks();
        if (currentId !== App.currentNoteId) return;
        const backrefs = [];
        Object.entries(links).forEach(([noteId, refs]) => {
            if (noteId === currentId) return;
            refs.forEach((ref) => {
                if (ref === currentId) {
                    const n = State.getNote(noteId);
                    if (n && !n.deletedAt) backrefs.push(n);
                }
            });
        });
        if (!backrefs.length) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        list.innerHTML = '';
        backrefs.forEach((n) => {
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<i class="fas fa-file-alt" style="color:var(--text-tertiary);font-size:.8rem;"></i> ${Utils.escapeHtml(n.title || T('untitled'))}`;
            el.addEventListener('click', () => App.openEditor(n.id));
            list.appendChild(el);
        });
    };

    // Scan all note contents for internal links: returns { noteId: [linkedNoteIds] }
    App.findAllLinks = function () {
        const result = {};
        const live = State.liveNotes();
        const loadPromises = live.map(async (n) => {
            const html = await DB.getContent(n.id);
            const ids = [];
            const re = /data-note="([^"]*)"/g;
            let m;
            while ((m = re.exec(html)) !== null) {
                if (m[1]) ids.push(m[1]);
            }
            result[n.id] = ids;
        });
        return Promise.all(loadPromises).then(() => result);
    };

    /* ============================================
       Folder helpers (creation / move)
       ============================================ */
    App.moveFolderTo = function (folderId, targetParentId) {
        const f = State.getFolder(folderId);
        if (!f) return;
        if (folderId === targetParentId) return;
        f.parentId = targetParentId || null;
        State.save();
        App.renderFolderTree();
    };

    App.deleteFolder = async function (folderId) {
        const f = State.getFolder(folderId);
        if (!f) return;
        const ok = await confirmDialog(`Delete folder "${f.name}"? Notes inside will become Uncategorized.`, 'Delete');
        if (!ok) return;
        const descendants = [folderId, ...State.allFolderIds(folderId).filter((x) => x !== folderId)];
        descendants.forEach((id) => {
            State.notes.forEach((n) => { if (n.folderId === id) n.folderId = null; });
            State.folders = State.folders.filter((x) => x.id !== id);
        });
        if (App.currentFolder === folderId) App.currentFolder = null;
        State.save();
        App.renderSidebar();
        App.renderNotes();
        toast('Folder deleted', 'info');
    };

    App.promptFolderRename = function (folder) {
        const name = prompt('Folder name:', folder.name);
        if (name && name.trim()) {
            folder.name = name.trim();
            State.save();
            App.renderSidebar();
        }
    };

    App.promptFolderPicker = function (title) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            const buildTree = (parentId, depth) => {
                let html = '';
                State.folders.filter((f) => f.parentId === parentId).forEach((f) => {
                    const count = State.folderNotes(f.id).length;
                    html += `<div class="command-item" data-id="${f.id}" style="padding-left:${16 + depth * 16}px;">
                        <i class="fas fa-folder" style="color:${Utils.escapeHtml(f.color || '#6C5CE7')}"></i>
                        <span>${Utils.escapeHtml(f.name)}</span> <span style="color:var(--text-tertiary);font-size:.8rem;">(${count})</span>
                    </div>`;
                    html += buildTree(f.id, depth + 1);
                });
                return html;
            };
            modal.innerHTML = `
                <div class="command-palette" style="width:90%;max-width:360px;background:var(--bg-primary);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);overflow:hidden;animation:slideUp .15s ease;">
                    <div class="command-input-wrap" style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;">
                        <i class="fas fa-folder" style="color:var(--text-tertiary);"></i>
                        <span style="font-weight:600;">${Utils.escapeHtml(title)}</span>
                    </div>
                    <div class="command-list" style="padding:6px;">
                        <div class="command-item" data-id="">
                            <i class="fas fa-folder-open"></i> <span>Uncategorized</span>
                        </div>
                        ${buildTree(null, 0)}
                    </div>
                </div>`;
            modal.addEventListener('click', (e) => {
                const item = e.target.closest('[data-id]');
                if (!item) { if (e.target === modal) { modal.remove(); resolve(null); } return; }
                modal.remove();
                resolve(item.dataset.id || null);
            });
            document.body.appendChild(modal);
        });
    };

    /* ============================================
       Block system helpers
       ============================================ */
    App.prepareBlocksForSave = function (container) {
        // Normalize empty trailing nodes
        container.querySelectorAll('.checklist-item.checked').forEach((li) => {
            const box = li.querySelector('input');
            if (box && box.checked) li.classList.add('checked');
        });
        // Cleanup drag handles if any
        container.querySelectorAll('.block-handle').forEach((h) => h.remove());
    };

    App.focusModeOpen = function () {
        // Defined in features file; placeholder guard
        if (window.Mulhim.Features) window.Mulhim.Features.openFocusMode();
    };
})();