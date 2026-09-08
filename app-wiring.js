/* ============================================
   Mulhim — Wiring, Settings, Shortcuts, Init
   Loads last.
   ============================================ */
(function () {
    'use strict';
    const { Utils, DB, State, toast, confirmDialog, i18n } = window.Mulhim;
    const App = window.Mulhim.App;
    const Features = window.Mulhim.Features;

    /* ============================================
       Theme & Language & Settings
       ============================================ */
    App.applySettings = function () {
        const s = State.settings;
        // Theme
        let theme = s.theme;
        if (theme === 'auto') {
            theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.dataset.theme = theme;
        const themeBtn = document.getElementById('themeToggle');
        if (themeBtn) themeBtn.innerHTML =
            theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        // Font size
        document.documentElement.dataset.fontSize = s.fontSize || 'normal';
        // Accent color
        document.documentElement.dataset.accent = s.accentColor || '#6C5CE7';
        // Language / RTL
        if (s.lang === 'ar') {
            document.documentElement.lang = 'ar';
            document.documentElement.dir = 'rtl';
        } else {
            document.documentElement.lang = 'en';
            document.documentElement.dir = 'ltr';
        }
        // Translate static UI
        if (window.Mulhim.i18n) window.Mulhim.i18n.apply();
        const titleEl = document.getElementById('appTitle');
        if (titleEl) titleEl.textContent = window.Mulhim.i18n ? window.Mulhim.i18n.t('appName') : 'Mulhim';
        // Profile
        const prof = document.getElementById('profileNameDisplay');
        if (prof) prof.textContent = s.profileName || (window.Mulhim.i18n ? window.Mulhim.i18n.t('appName') : 'Mulhim');
        // Sidebar collapse state
        const sidebar = document.getElementById('sidebar');
        if (s.sidebarCollapsed && window.innerWidth > 768) {
            sidebar.classList.add('collapsed');
        } else {
            sidebar.classList.remove('collapsed');
        }
        const themeSel = document.getElementById('settingTheme');
        const langSel = document.getElementById('settingLang');
        const trashSel = document.getElementById('settingTrashDays');
        const fontSel = document.getElementById('settingFontSize');
        if (themeSel) themeSel.value = s.theme;
        if (langSel) langSel.value = s.lang;
        if (trashSel) trashSel.value = s.trashDays || 7;
        if (fontSel) fontSel.value = s.fontSize || 'normal';
        const nameSel = document.getElementById('settingProfileName');
        if (nameSel) nameSel.value = s.profileName || '';
        // Accent picker
        document.querySelectorAll('#settingAccentPicker .color-dot').forEach((dot) => {
            dot.classList.toggle('selected', dot.dataset.color === (s.accentColor || '#6C5CE7'));
        });
    };

    App.toggleTheme = function () {
        State.settings.theme = State.settings.theme === 'dark' ? 'light' : 'dark';
        State.save(true);
        App.applySettings();
    };

    function bindSettings() {
        document.getElementById('settingTheme').addEventListener('change', (e) => {
            State.settings.theme = e.target.value;
            State.save();
            App.applySettings();
        });
        document.getElementById('settingLang').addEventListener('change', (e) => {
            State.settings.lang = e.target.value;
            State.save();
            App.applySettings();
            App.renderSidebar();
            App.showView(App.currentView);
        });
        document.getElementById('settingTrashDays').addEventListener('change', (e) => {
            State.settings.trashDays = Number(e.target.value);
            State.save();
            toast(i18n.t('trashRetention') + ' ' + i18n.t('saved'), 'success');
        });
        document.getElementById('settingFontSize').addEventListener('change', (e) => {
            State.settings.fontSize = e.target.value;
            State.save();
            App.applySettings();
        });
        document.getElementById('settingProfileName').addEventListener('change', (e) => {
            State.settings.profileName = e.target.value.trim();
            State.save();
            App.applySettings();
            App.renderSidebar();
        });
        document.getElementById('settingAccentPicker').addEventListener('click', (e) => {
            const dot = e.target.closest('.color-dot');
            if (!dot) return;
            State.settings.accentColor = dot.dataset.color;
            State.save();
            App.applySettings();
        });

        // Lang toggle shortcut
        document.getElementById('langToggle').addEventListener('click', () => {
            State.settings.lang = State.settings.lang === 'ar' ? 'en' : 'ar';
            State.save();
            App.applySettings();
            App.renderSidebar();
            App.showView(App.currentView);
            toast(i18n.t('language') + ': ' + State.settings.lang.toUpperCase(), 'info');
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            document.getElementById('settingsModal').style.display = 'flex';
            App.applySettings(); // refresh values in the modal
        });
        document.getElementById('exportAllBtn').addEventListener('click', () => Features.exportBackup());
        document.getElementById('importAllBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
        document.getElementById('importFileInput').addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) Features.importBackup(e.target.files[0]);
            e.target.value = '';
        });
        document.getElementById('clearAllBtn').addEventListener('click', async () => {
            const ok = await confirmDialog(i18n.t('clearAllData') + '? ' + i18n.t('backupExported'), i18n.t('delete'));
            if (!ok) return;
            localStorage.removeItem('mulhim_data_v1');
            indexedDB.deleteDatabase('mulhim_db');
            location.reload();
        });
    }

    /* ============================================
       Folder Modal (create)
       ============================================ */
    let editingFolderId = null;
    let selectedFolderColor = '#6C5CE7';

    App.promptCreateFolder = function () {
        openFolderModal(null);
    };

    function openFolderModal(existing) {
        editingFolderId = existing ? existing.id : null;
        selectedFolderColor = existing ? (existing.color || '#6C5CE7') : '#6C5CE7';
        document.getElementById('folderModalTitle').textContent = existing ? 'Edit Folder' : 'New Folder';
        document.getElementById('folderNameInput').value = existing ? existing.name : '';
        // build parent select (exclude self and descendants)
        const sel = document.getElementById('folderParentSelect');
        sel.innerHTML = '<option value="">Root</option>';
        const buildOpts = (parentId, depth) => {
            State.folders.filter((f) => f.parentId === parentId).forEach((f) => {
                const disabled = existing && (f.id === existing.id || State.allFolderIds(existing.id).includes(f.id));
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.textContent = '—'.repeat(depth) + ' ' + f.name;
                if (disabled) opt.disabled = true;
                sel.appendChild(opt);
            });
        };
        buildOpts(null, 0);
        if (existing && existing.parentId) sel.value = existing.parentId;
        // color picker
        document.querySelectorAll('#folderColorPicker .color-dot').forEach((dot) => {
            dot.classList.toggle('selected', dot.dataset.color === selectedFolderColor);
        });
        document.getElementById('folderModal').style.display = 'flex';
    }

    function bindFolderModal() {
        document.getElementById('addFolderBtn').addEventListener('click', () => openFolderModal(null));
        document.getElementById('folderColorPicker').addEventListener('click', (e) => {
            const dot = e.target.closest('.color-dot');
            if (!dot) return;
            selectedFolderColor = dot.dataset.color;
            document.querySelectorAll('#folderColorPicker .color-dot').forEach((d) => d.classList.toggle('selected', d.dataset.color === selectedFolderColor));
        });
        document.getElementById('folderSaveBtn').addEventListener('click', () => {
            const name = document.getElementById('folderNameInput').value.trim();
            if (!name) { toast('Folder name required', 'error'); return; }
            const parentId = document.getElementById('folderParentSelect').value || null;
            if (editingFolderId) {
                const f = State.getFolder(editingFolderId);
                if (f) {
                    f.name = name;
                    f.color = selectedFolderColor;
                    if (parentId && parentId !== f.id) f.parentId = parentId;
                }
                toast('Folder updated', 'success');
            } else {
                State.folders.push({
                    id: Utils.uid(),
                    name,
                    parentId,
                    color: selectedFolderColor,
                    createdAt: Date.now()
                });
                toast('Folder created', 'success');
            }
            State.save();
            App.renderSidebar();
            document.getElementById('folderModal').style.display = 'none';
        });
    }

    /* ============================================
       Navigation & Topbar wiring
       ============================================ */
    function bindNavigation() {
        document.querySelectorAll('.nav-item').forEach((item) => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                App.currentFolder = null;
                App.currentTag = null;
                if (view === 'daily') { App.openDailyNote(); return; }
                if (view === 'favorites') { App.showView('favorites'); return; }
                App.showView(view);
                closeMobileSidebar();
            });
        });

        document.getElementById('sidebarSearch').addEventListener('click', App.showSearch);

        document.getElementById('sidebarToggle').addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('collapsed');
            State.settings.sidebarCollapsed = sidebar.classList.contains('collapsed');
            State.save();
        });
        document.getElementById('sidebarExpandBtn').addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.remove('collapsed');
            State.settings.sidebarCollapsed = false;
            State.save();
        });

        document.getElementById('mobileMenuBtn').addEventListener('click', openMobileSidebar);
        document.getElementById('sidebarOverlay').addEventListener('click', closeMobileSidebar);

        function openMobileSidebar() {
            document.getElementById('sidebar').classList.add('open');
            document.getElementById('sidebarOverlay').classList.add('active');
        }
        function closeMobileSidebar() {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('active');
        }
        window.Mulhim.closeMobileSidebar = closeMobileSidebar;

        // New note
        const newNote = () => {
            App.currentFolder = App.currentFolder || null;
            App.createNote();
            closeMobileSidebar();
        };
        document.getElementById('newNoteBtn').addEventListener('click', newNote);
        document.getElementById('emptyNewNote').addEventListener('click', newNote);

        // New note → template dropdown (split button)
        const tdd = document.getElementById('templateDropdown');
        document.getElementById('newNoteCaret').addEventListener('click', (e) => {
            e.stopPropagation();
            Features.renderTemplateMenu();
            tdd.style.display = tdd.style.display === 'block' ? 'none' : 'block';
        });
        tdd.addEventListener('click', async (e) => {
            const item = e.target.closest('.td-item');
            if (!item) return;
            tdd.style.display = 'none';
            Features.createFromTemplate(item.dataset.key);
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.new-note-wrap')) tdd.style.display = 'none';
        });

        // Sort
        document.getElementById('sortBtn').addEventListener('click', () => {
            const dd = document.getElementById('sortDropdown');
            dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#sortBtn') && !e.target.closest('#sortDropdown')) {
                document.getElementById('sortDropdown').style.display = 'none';
            }
        });
        document.querySelectorAll('#sortDropdown .sort-option').forEach((opt) => {
            opt.addEventListener('click', () => {
                State.settings.sort = opt.dataset.sort;
                State.save();
                App.renderNotes();
                document.getElementById('sortDropdown').style.display = 'none';
            });
        });

        // View toggle
        document.querySelectorAll('#viewToggle .view-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                State.settings.view = btn.dataset.view;
                State.save();
                App.renderNotes();
            });
        });

        // Quick add
        document.getElementById('quickAddBtn').addEventListener('click', () => {
            document.getElementById('quickAddModal').style.display = 'flex';
        });
        const quickInput = document.getElementById('quickAddInput');
        let quickType = 'note';
        document.querySelectorAll('.quick-add-option').forEach((opt) => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.quick-add-option').forEach((o) => o.style.borderColor = '');
                opt.style.borderColor = 'var(--accent)';
                if (opt.dataset.type === 'note') {
                    document.getElementById('quickAddModal').style.display = 'none';
                    App.createNote();
                    return;
                }
                quickType = opt.dataset.type;
                quickInput.style.display = 'block';
                quickInput.placeholder = quickType === 'folder' ? 'Folder name' : 'Task description';
                quickInput.value = '';
                quickInput.focus();
            });
        });
        quickInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && quickInput.value.trim()) {
                if (quickType === 'folder') {
                    State.folders.push({ id: Utils.uid(), name: quickInput.value.trim(), parentId: null, color: '#6C5CE7', createdAt: Date.now() });
                    State.save();
                    App.renderSidebar();
                    toast('Folder created', 'success');
                } else if (quickType === 'task') {
                    const note = App.createNote({ title: 'Tasks', returnContent: false });
                    DB.setContent(note.id, `<ul class="checklist"><li class="checklist-item"><input type="checkbox"><span>${Utils.escapeHtml(quickInput.value.trim())}</span></li></ul>`);
                    App.openEditor(note.id);
                }
                document.getElementById('quickAddModal').style.display = 'none';
                quickInput.style.display = 'none';
                quickInput.value = '';
            }
        });

        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', App.toggleTheme);

        // Calendar navigation
        document.getElementById('calPrev').addEventListener('click', () => {
            Features.calMonth--;
            if (Features.calMonth < 0) { Features.calMonth = 11; Features.calYear--; }
            App.renderCalendar();
        });
        document.getElementById('calNext').addEventListener('click', () => {
            Features.calMonth++;
            if (Features.calMonth > 11) { Features.calMonth = 0; Features.calYear++; }
            App.renderCalendar();
        });
    }

    /* ============================================
       Editor wiring (buttons / menu / image)
       ============================================ */
    function bindEditor() {
        document.getElementById('editorBack').addEventListener('click', () => App.closeEditor(true));

        App.els.noteTitle.addEventListener('input', Utils.debounce(() => {
            App.saveEditorContent();
            App.updateTitleIndex(State.getNote(App.currentNoteId));
        }, 250));

        App.els.noteFavoriteBtn.addEventListener('click', () => {
            if (App.currentNoteId) App.toggleFavorite(App.currentNoteId);
        });
        App.els.notePinBtn.addEventListener('click', () => {
            if (App.currentNoteId) App.togglePin(App.currentNoteId);
        });

        document.getElementById('focusModeBtn').addEventListener('click', () => {
            if (App.currentNoteId) Features.openFocusMode(App.currentNoteId);
        });

        document.getElementById('noteTagsBtn').addEventListener('click', App.promptNoteTag);

        document.getElementById('noteFolderBtn').addEventListener('click', async () => {
            const folderId = await App.promptFolderPicker('Move note to folder');
            if (folderId === null) return;
            const n = State.getNote(App.currentNoteId);
            if (n) { n.folderId = folderId; n.updatedAt = Date.now(); }
            State.save();
            App.renderSidebar();
            toast('Note moved', 'success');
        });

        // Note menu
        const menu = document.getElementById('noteMenu');
        document.getElementById('noteMenuBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#noteMenu') && !e.target.closest('#noteMenuBtn')) menu.style.display = 'none';
        });
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.note-menu-item');
            if (!item) return;
            const action = item.dataset.action;
            menu.style.display = 'none';
            if (!App.currentNoteId) return;
            switch (action) {
                case 'duplicate': App.duplicateNote(App.currentNoteId); break;
                case 'saveTemplate': App.saveNoteAsTemplate(); break;
                case 'toggleHide': App.toggleNoteHide(App.currentNoteId); break;
                case 'exportTxt': App.exportNoteAs('txt'); break;
                case 'exportMd': App.exportNoteAs('md'); break;
                case 'exportHtml': App.exportNoteAs('html'); break;
                case 'archive': App.toggleArchiveNoteEditor(); break;
                case 'move': document.getElementById('noteFolderBtn').click(); break;
                case 'delete': asyncTrigger(() => App.deleteNote(App.currentNoteId).then(() => { if (App.currentNoteId && State.getNote(App.currentNoteId) && State.getNote(App.currentNoteId).deletedAt) App.closeEditor(); })); break;
            }
        });

        // Image upload
        document.getElementById('imageUploadInput').addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > 3 * 1024 * 1024) {
                toast('Image too large (max 3MB)', 'error');
                e.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = document.createElement('img');
                img.src = ev.target.result;
                img.style.maxWidth = '100%';
                insertIntoActiveEditor(img);
                App.saveEditorContent();
                e.target.value = '';
            };
            reader.readAsDataURL(file);
        });
    }

    function asyncTrigger(fn) { fn(); }

    function insertIntoActiveEditor(node) {
        const mode = document.getElementById('focusMode');
        let body;
        if (mode.style.display === 'flex') body = document.getElementById('focusBody');
        else body = App.els.editorBody;
        body.focus();
        const sel = window.getSelection();
        if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            body.appendChild(node);
        }
        body.dispatchEvent(new Event('input'));
    }

    /* ============================================
       Modals: close on overlay / X
       ============================================ */
    function bindModals() {
        document.querySelectorAll('.modal-overlay').forEach((overlay) => {
            overlay.addEventListener('mousedown', (e) => {
                if (e.target === overlay) overlay.style.display = 'none';
            });
            overlay.querySelectorAll('.modal-close').forEach((btn) => {
                btn.addEventListener('click', () => { overlay.style.display = 'none'; });
            });
        });

        // Confirm modal
        const confirmModal = document.getElementById('confirmModal');
        const confirmAction = document.getElementById('confirmAction');
        const closeConfirm = () => { confirmModal.style.display = 'none'; if (window.Mulhim._confirmResolve) { window.Mulhim._confirmResolve(false); window.Mulhim._confirmResolve = null; } };
        confirmModal.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', closeConfirm));
        confirmModal.addEventListener('mousedown', (e) => { if (e.target === confirmModal) closeConfirm(); });
        // Override confirmDialog from storage to use real Resolver
    }

    // Patch the confirmDialog to support the button (storage version stores resolve internally)
    function patchConfirm() {
        const confirmModal = document.getElementById('confirmModal');
        const confirmAction = document.getElementById('confirmAction');
        confirmAction.addEventListener('click', () => {
            confirmModal.style.display = 'none';
            if (window.Mulhim._confirmResolve) { window.Mulhim._confirmResolve(true); window.Mulhim._confirmResolve = null; }
        });
        // The storage.js confirmDialog sets its own confirmResolve; we bridge by caching on window
        const origDialog = window.Mulhim.confirmDialog;
        window.Mulhim.confirmDialog = function (message, confirmText) {
            return new Promise((resolve) => {
                window.Mulhim._confirmResolve = resolve;
                document.getElementById('confirmMessage').textContent = message;
                document.getElementById('confirmAction').textContent = confirmText || 'Confirm';
                confirmModal.style.display = 'flex';
                confirmAction.focus();
            });
        };
    }

    /* ============================================
       Keyboard Shortcuts
       ============================================ */
    function bindShortcuts() {
        document.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            const isTyping = tag === 'input' || tag === 'textarea' || (e.target.isContentEditable);
            const ctrl = e.ctrlKey || e.metaKey;

            if (e.key === 'Escape') {
                const focusMode = document.getElementById('focusMode');
                if (focusMode.style.display === 'flex') {
                    Features.exitFocusMode();
                    return;
                }
                // close any open modal
                document.querySelectorAll('.modal-overlay').forEach((m) => {
                    if (m.style.display === 'flex') {
                        m.style.display = 'none';
                        if (m.id === 'confirmModal' && window.Mulhim._confirmResolve) {
                            window.Mulhim._confirmResolve(false);
                            window.Mulhim._confirmResolve = null;
                        }
                    }
                });
                return;
            }

            if (ctrl && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                if (!isTyping) window.Mulhim.openCommandPalette();
                else if (!/(textarea|input)/.test(tag) && e.target.isContentEditable) { window.Mulhim.openCommandPalette(); }
                return;
            }
            if (ctrl && (e.key === 'n' || e.key === 'N')) {
                e.preventDefault();
                App.createNote();
                return;
            }
            if (ctrl && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                if (App.currentNoteId) Features.openFocusMode(App.currentNoteId);
                return;
            }
            if (ctrl && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                App.saveEditorContent(true);
                toast('Saved', 'success');
                return;
            }
            if (ctrl && (e.key === 'b' || e.key === 'B') && e.target.isContentEditable) {
                e.preventDefault();
                document.execCommand('bold');
                return;
            }
            if (ctrl && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                App.showSearch();
            }
        });
    }

    /* ============================================
       Init
       ============================================ */
    function init() {
        // Load state
        State.load();
        State.purgeOldTrash();

        App.els = App.elsGet();

        // Fresh welcome content
        if (!DB._db) DB.open();

        // Bind everything
        Features.bindToolbar();
        Features.bindEditorEvents();
        Features.bindSearch();
        Features.bindCommandPalette();
        Features.bindFocusMode();
        Features.populateSearchFilters();
        bindSettings();
        bindFolderModal();
        bindNavigation();
        bindEditor();
        bindModals();
        patchConfirm();
        bindShortcuts();
        if (window.Mulhim.closeMobileSidebar) window.Mulhim.closeMobileSidebar();

        // Render initial
        App.renderSidebar();
        App.showView('notes');
        App._lastSavedHtml = '';
    }

    // Autosave before closing
    window.addEventListener('beforeunload', () => {
        if (App.currentNoteId) App.saveEditorContent(true);
        State.save(true);
    });

    // Focus mode Esc handled in shortcuts; also mark dragging for graph
    document.addEventListener('DOMContentLoaded', init);
})();