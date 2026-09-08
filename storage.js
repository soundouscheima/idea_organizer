/* ============================================
   Mulhim — Storage & Utilities Layer
   Loaded first. Defines window.Utils, window.DB, window.State.
   ============================================ */
(function () {
    'use strict';

    // ---------- Utility functions ----------
    const Utils = {
        uid() {
            return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        },
        tagId() {
            return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        },
        debounce(fn, wait) {
            let t;
            return function (...args) {
                clearTimeout(t);
                t = setTimeout(() => fn.apply(this, args), wait);
            };
        },
        throttle(fn, limit) {
            let inThrottle = false;
            return function (...args) {
                if (!inThrottle) {
                    fn.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => (inThrottle = false), limit);
                }
            };
        },
        escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
        unescapeHtml(str) {
            const doc = new DOMParser().parseFromString(String(str), 'text/html');
            return doc.body.textContent || '';
        },
        stripHtml(html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html || '';
            return tmp.textContent || tmp.innerText || '';
        },
        wordCount(text) {
            const trimmed = String(text || '').trim();
            if (!trimmed) return 0;
            return trimmed.split(/\s+/).length;
        },
        readingTime(text) {
            const wc = Utils.wordCount(text);
            return Math.max(1, Math.round(wc / 200));
        },
        formatDate(ts) {
            return new Date(ts).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric'
            });
        },
        formatDateTime(ts) {
            return new Date(ts).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        },
        timeAgo(ts) {
            const diff = Date.now() - ts;
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            const days = Math.floor(hrs / 24);
            if (days < 30) return days + 'd ago';
            const months = Math.floor(days / 30);
            if (months < 12) return months + 'mo ago';
            return Math.floor(months / 12) + 'y ago';
        },
        todayStr() {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        },
        download(filename, content, mime) {
            const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        },
        locale() {
            return window.State && window.State.settings.lang === 'ar' ? 'ar' : 'en';
        },
        isPlainTextNode(node) {
            return node.nodeType === 3;
        }
    };

    // ---------- Toast notifications ----------
    function toast(message, type) {
        type = type || 'info';
        const container = document.getElementById('toastContainer');
        const el = document.createElement('div');
        el.className = 'toast ' + type;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span></span>`;
        el.querySelector('span').textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(40px)';
            setTimeout(() => el.remove(), 300);
        }, 2500);
    }

    // ---------- Confirmation modal (promise based) ----------
    let confirmResolve = null;
    function confirmDialog(message, confirmText) {
        return new Promise((resolve) => {
            confirmResolve = resolve;
            if (window.Mulhim) window.Mulhim._confirmResolve = resolve;
            document.getElementById('confirmMessage').textContent = message;
            document.getElementById('confirmAction').textContent = confirmText || 'Confirm';
            document.getElementById('confirmModal').style.display = 'flex';
            document.getElementById('confirmAction').focus();
        });
    }

    // ---------- IndexedDB wrapper ----------
    const DB = {
        dbName: 'mulhim_db',
        store: 'content',
        _db: null,
        open() {
            if (this._db) return Promise.resolve(this._db);
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(this.dbName, 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.store)) {
                        db.createObjectStore(this.store, { keyPath: 'id' });
                    }
                };
                req.onsuccess = (e) => {
                    this._db = e.target.result;
                    resolve(this._db);
                };
                req.onerror = (e) => {
                    toast('Storage error: could not open IndexedDB', 'error');
                    reject(e);
                };
            });
        },
        async setContent(id, html) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.store, 'readwrite');
                tx.objectStore(this.store).put({ id, html: html || '' });
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => { toast('Storage write failed. Check browser quotas.', 'error'); reject(e); };
            });
        },
        async getContent(id) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.store, 'readonly');
                const req = tx.objectStore(this.store).get(id);
                req.onsuccess = (e) => resolve(e.target.result ? e.target.result.html : '');
                req.onerror = (e) => reject(e);
            });
        },
        async deleteContent(id) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.store, 'readwrite');
                tx.objectStore(this.store).delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e);
            });
        },
        async getAllContent() {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.store, 'readonly');
                const req = tx.objectStore(this.store).getAll();
                req.onsuccess = (e) => resolve(e.target.result || []);
                req.onerror = (e) => reject(e);
            });
        }
    };

    // ---------- State persistence ----------
    const STORAGE_KEY = 'mulhim_data_v1';
    const DEFAULT_STATE = {
        settings: {
            theme: 'light',
            lang: 'en',
            view: 'grid',
            sort: 'updatedAt',
            trashDays: 7,
            sidebarCollapsed: false,
            profileName: '',
            fontSize: 'normal',
            accentColor: '#6C5CE7'
        },
        folders: [],
        tags: [],
        notes: [],
        templates: [],
        goals: [],
        dailyIndex: {}
    };

    const State = {
        settings: DEFAULT_STATE.settings,
        folders: [],
        tags: [],
        notes: [],
        templates: [],
        goals: [],
        dailyIndex: {},
        _saveTimer: null,
        lastBackup: null,

        load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) {
                    this.seed();
                    return;
                }
                const data = JSON.parse(raw);
                // Validate each key; fall back to defaults if corrupted
                this.settings = Object.assign({}, DEFAULT_STATE.settings, data.settings || {});
                this.folders = Array.isArray(data.folders) ? data.folders : [];
                this.tags = Array.isArray(data.tags) ? data.tags : [];
                this.notes = Array.isArray(data.notes) ? data.notes : [];
                this.templates = Array.isArray(data.templates) ? data.templates : [];
                this.goals = Array.isArray(data.goals) ? data.goals : [];
                this.dailyIndex = data.dailyIndex || {};
            } catch (err) {
                console.error('Corrupted state, restoring defaults', err);
                toast('Data file was corrupted. A fresh workspace was started.', 'error');
                this.seed();
            }
        },

        seed() {
            this.settings = Object.assign({}, DEFAULT_STATE.settings);
            const welcomeId = Utils.uid();
            this.notes = [{
                id: welcomeId,
                title: 'Welcome to Mulhim',
                folderId: null,
                tags: [],
                isPinned: true,
                isFavorite: true,
                isArchived: false,
                deletedAt: null,
                createdAt: Date.now(),
                updatedAt: Date.now()
            }];
            this.folders = [];
            this.tags = [];
            this.templates = [];
            this.goals = [];
            this.dailyIndex = {};
            // Seed welcome content template
            const welcomeContent = `
<p>Welcome to <b>Mulhim</b> — your mini-Notion for organizing ideas.</p>
<p>Here is what you can do:</p>
<ul>
<li><b>Type</b> to write — everything auto-saves instantly.</li>
<li>Create folders to organize notes and drag notes between them.</li>
<li>Add tags to categorize your notes.</li>
<li>Press <b>Ctrl+K</b> for the command palette, <b>Ctrl+N</b> for a new note.</li>
<li>Link notes together by typing <b>[[Second Brain]]</b> — unresolved links create the note on click.</li>
<li>Press <b>Ctrl+Shift+F</b> for a calm fullscreen focus mode.</li>
</ul>
<p>Good luck writing your ideas!</p>`;
            DB.setContent(welcomeId, welcomeContent).catch(() => {});
            this.save();
        },

        save(immediate) {
            if (immediate) {
                clearTimeout(this._saveTimer);
                this._persist();
                return;
            }
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this._persist(), 400);
        },

        _persist() {
            try {
                const data = {
                    settings: this.settings,
                    notes: this.notes,
                    folders: this.folders,
                    tags: this.tags,
                    templates: this.templates,
                    goals: this.goals,
                    dailyIndex: this.dailyIndex
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            } catch (err) {
                if (err && err.name === 'QuotaExceededError') {
                    toast('Local storage is full. Try exporting a backup and clearing old data.', 'error');
                } else {
                    console.error('Persist error', err);
                }
            }
        },

        getNote(id) {
            return this.notes.find((n) => n.id === id);
        },
        getFolder(id) {
            return this.folders.find((f) => f.id === id);
        },
        getTag(id) {
            return this.tags.find((t) => t.id === id);
        },
        getTemplate(id) {
            return this.templates.find((t) => t.id === id);
        },
        liveNotes() {
            return this.notes.filter((n) => !n.isArchived && !n.deletedAt);
        },
        visibleNotes() {
            return this.notes.filter((n) => !n.deletedAt);
        },

        // ----- Search helpers -----
        folderNotes(folderId) {
            return this.liveNotes().filter((n) => n.folderId === folderId);
        },
        noteTags(note) {
            return (note.tags || []).map((id) => this.getTag(id)).filter(Boolean);
        },
        folderChildren(parentId) {
            return this.folders.filter((f) => f.parentId === parentId);
        },
        allFolderIds(folderId) {
            const ids = [folderId];
            this.folderChildren(folderId).forEach((child) => ids.push(...this.allFolderIds(child.id)));
            return ids;
        },

        // ----- Trash auto-purge -----
        purgeOldTrash() {
            const days = Number(this.settings.trashDays) || 0;
            if (!days) return;
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const toPurge = this.notes.filter((n) => n.deletedAt && n.deletedAt < cutoff);
            toPurge.forEach((n) => {
                DB.deleteContent(n.id).catch(() => {});
            });
            if (toPurge.length) {
                this.notes = this.notes.filter((n) => !toPurge.includes(n));
                this.save();
            }
        }
    };

    // ---------- i18n (bilingual English / Arabic) ----------
    const I18N = {
        en: {
            appName: 'Mulhim',
            appTagline: 'Your idea workspace',
            allNotes: 'All Notes', favorites: 'Favorites', daily: 'Today\'s Note',
            templates: 'Templates', tagManager: 'Tag Manager', dashboard: 'Dashboard',
            trash: 'Trash', calendar: 'Calendar', graph: 'Knowledge Graph',
            tasks: 'Tasks', goals: 'Goals', archive: 'Archive', recent: 'Recently Opened',
            stats: 'Statistics', search: 'Search',
            folders: 'Folders', tags: 'Tags', uncategorized: 'Uncategorized',
            quickAdd: 'Quick Add', searchJump: 'Search or jump to...', newNote: 'New Note',
            saved: 'Saved', saving: 'Saving...', saveError: 'Save error',
            noNotes: 'No notes yet', createFirst: 'Create your first note to get started',
            createNote: 'Create Note', untitled: 'Untitled', words: 'words', minRead: 'min read',
            backlinks: 'Backlinks', noResults: 'No matching results found',
            emptyTrash: 'Trash is empty', restore: 'Restore', deleteForever: 'Delete forever',
            emptyTrashAction: 'Empty Trash', restoreBtn: 'Restore', deleteBtn: 'Delete',
            cancel: 'Cancel', save: 'Save', confirm: 'Confirm', delete: 'Delete',
            moveTo: 'Move to', addTag: 'Add Tag', pin: 'Pin', unpin: 'Unpin',
            favorite: 'Favorite', unfavorite: 'Unfavorite', archiveNote: 'Archive',
            duplicate: 'Duplicate', saveTemplate: 'Save as Template', exportTxt: 'Export as .txt',
            exportMd: 'Export as .md', exportHtml: 'Export as .html', moveNote: 'Move to...',
            hidePreview: 'Hide Preview', visualOnly: 'visual only', focusMode: 'Focus Mode',
            toggleTheme: 'Toggle Dark Mode', settings: 'Settings', language: 'Language',
            theme: 'Theme', trashRetention: 'Trash Auto-Delete', dataManagement: 'Data Management',
            exportBackup: 'Export Backup', importBackup: 'Import Backup', clearAllData: 'Clear All Data',
            allFolders: 'All Folders', allTags: 'All Tags', allTime: 'All Time',
            today: 'Today', thisWeek: 'This Week', thisMonth: 'This Month',
            totalNotes: 'Total Notes', totalFolders: 'Total Folders', totalWords: 'Total Words',
            completedTasks: 'Completed Tasks', recentlyOpened: 'Recently Opened',
            recentlyEdited: 'Recently Edited', mostUsedTags: 'Most Used Tags',
            pinnedFavorites: 'Pinned & Favorite', createFolder: 'New Folder', editFolder: 'Edit Folder',
            folderName: 'Folder name', folderNameReq: 'Folder name is required',
            root: 'Root', newTag: 'Add Tag', tagName: 'Tag name', saveAsTemplate: 'Save as Template',
            templateName: 'Template name', chooseColor: 'Choose a color code (e.g. #6C5CE7):',
            renameTag: 'Rename', deleteTag: 'Delete', tagNameReq: 'Tag name is required',
            newNoteFromTemplate: 'New note from template', blankNote: 'Blank note',
            startFromTemplate: 'Start from template', custom: 'Custom',
            noCustomTemplates: 'No custom templates yet. Open a note → ⋮ → Save as Template.',
            selectDay: 'Select a day', noNotesThisDay: 'No notes edited this day.',
            journal: 'journal', noTagsYet: 'No tags yet. Add tags to your notes to organize them.',
            notes: 'Notes', noteCreated: 'Note created', noteDuplicated: 'Note duplicated',
            savedAsTemplate: 'Saved as template', noteMoved: 'Note moved',
            noteArchived: 'Note archived', noteUnarchived: 'Note unarchived',
            movedToTrash: 'Note moved to trash',
            noteRestored: 'Note restored', noteDeletedForever: 'Note permanently deleted',
            trashEmptied: 'Trash emptied', tagAdded: 'Tag added', tagUpdated: 'Tag updated',
            tagColorUpdated: 'Tag color updated', tagRenamed: 'Tag renamed', tagDeleted: 'Tag deleted',
            folderCreated: 'Folder created', folderUpdated: 'Folder updated', folderDeleted: 'Folder deleted',
            backupExported: 'Backup exported', backupRestored: 'Backup restored successfully',
            importFailed: 'Import failed: invalid backup file', savedOk: 'Saved',
            imageTooLarge: 'Image too large (max 3MB)', storageFull: 'Local storage is full. Try exporting a backup and clearing old data.',
            storageError: 'Storage error: could not open IndexedDB', storageWrite: 'Storage write failed. Check browser quotas.',
            corruptedData: 'Data file was corrupted. A fresh workspace was started.',
            dailyCreated: 'Created your daily note', dailyTag: 'journal',
            noNotesOpened: 'No notes opened yet.', noNotesYet: 'No notes yet.',
            noPinnedFav: 'Pin or favorite a note to see it here.',
            startTyping: 'Start typing to search...', noMatchingCommands: 'No matching commands',
            archived: 'Archived', noArchived: 'No archived notes.', unarchive: 'Unarchive',
            taskProgress: '/ completed', tasksView: 'Tasks', noTasks: 'No tasks yet. Check off a checklist item in any note.',
            goalsView: 'Goals', noGoals: 'No goals yet. Create a goal to track progress.',
            addGoal: 'Add Goal', goalTitle: 'Goal title', goalTarget: 'Target (notes)',
            goalProgress: 'progress', recentView: 'Recently Opened',
            statsView: 'Notes Statistics', welcome: 'Welcome',
            greeting: 'Let\'s capture your ideas.', newTasks: 'New Task',
            profileName: 'Your Name', appNameLabel: 'App Name', fontSize: 'Font Size',
            accentColor: 'Accent Color', display: 'Display Settings', profile: 'Profile',
            fontSmall: 'Small', fontNormal: 'Normal', fontLarge: 'Large', fontXLarge: 'Extra Large',
            noMatchSearch: 'No matching results found', selectToMove: 'Move note to folder',
            moveNotesTo: 'Move notes to folder', addTagTo: 'Add tag to notes',
            notesSelected: 'notes selected', archivedN: 'notes archived',
            deleteNNotes: 'notes to trash?', deleted: 'Moved to trash',
            tagManagerTitle: 'Tag Manager', settingsTitle: 'Settings',
            edit: 'Edit', select: 'Select', create: 'Create', languageLabel: 'Language', themeLabel: 'Theme',
            hiddenNoteNote: 'Blurs this note in previews. Visual hiding only — NOT encryption or security.',
            startWriting: 'Start writing... Use [[ to link notes', startWriting2: 'Start writing...',
            cancel2: 'Cancel', enterName: 'Enter name...', newTask: 'New Task',
            allTimeView: 'All', pending: 'Pending', completed: 'Completed',
            themeLight: 'Light', themeDark: 'Dark', themeAuto: 'Auto',
            days7: '7 days', days14: '14 days', days30: '30 days', never: 'Never',
            aboutApp: 'All data is stored privately in your browser.',
            lastModified: 'Last Modified', creationDate: 'Creation Date', alphabetically: 'Alphabetically',
            accent: 'Accent', goalProgressNotes: 'notes completed toward this goal',
            goalDelete: 'Delete goal', goalDone: 'Goal achieved!', goalRemaining: 'remaining',
            goalCreated: 'Goal created', goalUpdated: 'Goal updated', goalDeleted: 'Goal deleted',
            noteProgress: '/ completed',
        },
        ar: {
            appName: 'ملهم', appTagline: 'مساحة عملك لأفكارك',
            allNotes: 'كل الملاحظات', favorites: 'المفضلة', daily: 'ملاحظة اليوم',
            templates: 'القوالب', tagManager: 'إدارة الوسوم', dashboard: 'لوحة التحكم',
            trash: 'سلة المهملات', calendar: 'التقويم', graph: 'الرسم البياني',
            tasks: 'المهام', goals: 'الأهداف', archive: 'الأرشيف', recent: 'مؤخرًا',
            stats: 'الإحصائيات', search: 'بحث',
            folders: 'المجلدات', tags: 'الوسوم', uncategorized: 'غير مصنف',
            quickAdd: 'إضافة سريعة', searchJump: 'ابحث أو انتقل إلى...', newNote: 'ملاحظة جديدة',
            saved: 'تم الحفظ', saving: 'جارٍ الحفظ...', saveError: 'خطأ في الحفظ',
            noNotes: 'لا توجد ملاحظات', createFirst: 'أنشئ أول ملاحظة للبدء',
            createNote: 'إنشاء ملاحظة', untitled: 'بدون عنوان', words: 'كلمة', minRead: 'دقائق قراءة',
            backlinks: 'روابط عائدة', noResults: 'لا توجد نتائج مطابقة',
            emptyTrash: 'سلة المهملات فارغة', restore: 'استعادة', deleteForever: 'حذف نهائي',
            emptyTrashAction: 'إفراغ السلة', restoreBtn: 'استعادة', deleteBtn: 'حذف',
            cancel: 'إلغاء', save: 'حفظ', confirm: 'تأكيد', delete: 'حذف',
            moveTo: 'نقل إلى', addTag: 'إضافة وسم', pin: 'تثبيت', unpin: 'إلغاء التثبيت',
            favorite: 'مفضلة', unfavorite: 'إلغاء المفضلة', archiveNote: 'أرشفة',
            duplicate: 'نسخ', saveTemplate: 'حفظ كقالب', exportTxt: 'تصدير كـ txt',
            exportMd: 'تصدير كـ md', exportHtml: 'تصدير كـ html', moveNote: 'نقل إلى...',
            hidePreview: 'إخفاء المعاينة', visualOnly: 'مرئي فقط', focusMode: 'وضع التركيز',
            toggleTheme: 'تبديل الوضع الداكن', settings: 'الإعدادات', language: 'اللغة',
            theme: 'السمة', trashRetention: 'حذف السلة تلقائيًا', dataManagement: 'إدارة البيانات',
            exportBackup: 'تصدير نسخة احتياطية', importBackup: 'استيراد نسخة احتياطية', clearAllData: 'مسح كل البيانات',
            allFolders: 'كل المجلدات', allTags: 'كل الوسوم', allTime: 'كل الأوقات',
            today: 'اليوم', thisWeek: 'هذا الأسبوع', thisMonth: 'هذا الشهر',
            totalNotes: 'إجمالي الملاحظات', totalFolders: 'إجمالي المجلدات', totalWords: 'إجمالي الكلمات',
            completedTasks: 'المهام المكتملة', recentlyOpened: 'مفتوح مؤخرًا',
            recentlyEdited: 'حُرّر مؤخرًا', mostUsedTags: 'الوسوم الأكثر استخدامًا',
            pinnedFavorites: 'المثبتة والمفضلة', createFolder: 'مجلد جديد', editFolder: 'تعديل مجلد',
            folderName: 'اسم المجلد', folderNameReq: 'اسم المجلد مطلوب',
            root: 'الجذر', newTag: 'إضافة وسم', tagName: 'اسم الوسم', saveAsTemplate: 'حفظ كقالب',
            templateName: 'اسم القالب', chooseColor: 'اختر رمز اللون (مثال #6C5CE7):',
            renameTag: 'إعادة تسمية', deleteTag: 'حذف', tagNameReq: 'اسم الوسم مطلوب',
            newNoteFromTemplate: 'ملاحظة جديدة من قالب', blankNote: 'ملاحظة فارغة',
            startFromTemplate: 'ابدأ من قالب', custom: 'مخصص',
            noCustomTemplates: 'لا توجد قوالب مخصصة بعد. افتح ملاحظة ← ⋮ ← حفظ كقالب.',
            selectDay: 'اختر يومًا', noNotesThisDay: 'لا توجد ملاحظات حُرّرت في هذا اليوم.',
            journal: 'مذكرات', noTagsYet: 'لا توجد وسوم بعد. أضف وسومًا لملاحظاتك لتنظيمها.',
            notes: 'الملاحظات', noteCreated: 'تم إنشاء الملاحظة', noteDuplicated: 'تم نسخ الملاحظة',
            savedAsTemplate: 'تم الحفظ كقالب', noteMoved: 'تم نقل الملاحظة',
            noteArchived: 'تم أرشفة الملاحظة', noteUnarchived: 'تم إلغاء أرشفة الملاحظة',
            movedToTrash: 'نُقلت الملاحظة إلى السلة',
            noteRestored: 'تمت استعادة الملاحظة', noteDeletedForever: 'تم حذف الملاحظة نهائيًا',
            trashEmptied: 'تم إفراغ السلة', tagAdded: 'تمت إضافة الوسم', tagUpdated: 'تم تحديث الوسم',
            tagColorUpdated: 'تم تحديث لون الوسم', tagRenamed: 'تمت إعادة تسمية الوسم', tagDeleted: 'تم حذف الوسم',
            folderCreated: 'تم إنشاء المجلد', folderUpdated: 'تم تحديث المجلد', folderDeleted: 'تم حذف المجلد',
            backupExported: 'تم تصدير النسخة الاحتياطية', backupRestored: 'تمت استعادة النسخة الاحتياطية بنجاح',
            importFailed: 'فشل الاستيراد: ملف نسخة احتياطية غير صالح', savedOk: 'تم الحفظ',
            imageTooLarge: 'الصورة كبيرة جدًا (الحد الأقصى 3 ميجابايت)', storageFull: 'مساحة التخزين ممتلئة. جرّب تصدير نسخة احتياطية ومسح البيانات القديمة.',
            storageError: 'خطأ في التخزين: تعذر فتح IndexedDB', storageWrite: 'فشل كتابة التخزين. تحقق من حصص المتصفح.',
            corruptedData: 'تلف ملف البيانات. تم بدء مساحة عمل جديدة.',
            dailyCreated: 'تم إنشاء ملاحظة اليوم', dailyTag: 'مذكرات',
            noNotesOpened: 'لم تُفتح أي ملاحظات بعد.', noNotesYet: 'لا توجد ملاحظات بعد.',
            noPinnedFav: 'ثبّت أو ضع ملاحظة في المفضلة لتظهر هنا.',
            startTyping: 'ابدأ الكتابة للبحث...', noMatchingCommands: 'لا توجد أوامر مطابقة',
            archived: 'المؤرشفة', noArchived: 'لا توجد ملاحظات مؤرشفة.', unarchive: 'إلغاء الأرشفة',
            taskProgress: '/ مكتمل', tasksView: 'المهام', noTasks: 'لا توجد مهام بعد. حدّد عنصر قائمة تحقق في أي ملاحظة.',
            goalsView: 'الأهداف', noGoals: 'لا توجد أهداف بعد. أنشئ هدفًا لتتبع التقدم.',
            addGoal: 'إضافة هدف', goalTitle: 'عنوان الهدف', goalTarget: 'الهدف (ملاحظات)',
            goalProgress: 'تقدم', recentView: 'مفتوح مؤخرًا',
            statsView: 'إحصائيات الملاحظات', welcome: 'مرحبًا',
            greeting: 'دعنا نلتقط أفكارك.', newTasks: 'مهمة جديدة',
            profileName: 'اسمك', appNameLabel: 'اسم التطبيق', fontSize: 'حجم الخط',
            accentColor: 'لون التمييز', display: 'إعدادات العرض', profile: 'الملف الشخصي',
            fontSmall: 'صغير', fontNormal: 'عادي', fontLarge: 'كبير', fontXLarge: 'كبير جدًا',
            noMatchSearch: 'لا توجد نتائج مطابقة', selectToMove: 'نقل الملاحظة إلى مجلد',
            moveNotesTo: 'نقل الملاحظات إلى مجلد', addTagTo: 'إضافة وسم إلى الملاحظات',
            notesSelected: 'ملاحظات محددة', archivedN: 'ملاحظات مؤرشفة',
            deleteNNotes: 'ملاحظة إلى السلة؟', deleted: 'نُقلت إلى السلة',
            tagManagerTitle: 'إدارة الوسوم', settingsTitle: 'الإعدادات',
            edit: 'تعديل', select: 'تحديد', create: 'إنشاء', languageLabel: 'اللغة', themeLabel: 'السمة',
            hiddenNoteNote: 'يخفي معاينة هذه الملاحظة. إخفاء بصري فقط — ليس تشفيرًا أو أمانًا.',
            startWriting: 'ابدأ الكتابة... استخدم [[ للربط بين الملاحظات', startWriting2: 'ابدأ الكتابة...',
            cancel2: 'إلغاء', enterName: 'أدخل الاسم...', newTask: 'مهمة جديدة',
            allTimeView: 'الكل', pending: 'قيد الانتظار', completed: 'مكتمل',
            themeLight: 'فاتح', themeDark: 'داكن', themeAuto: 'تلقائي',
            days7: '7 أيام', days14: '14 يومًا', days30: '30 يومًا', never: 'أبدًا',
            aboutApp: 'جميع البيانات تُخزن بشكل خاص في متصفحك.',
            lastModified: 'آخر تعديل', creationDate: 'تاريخ الإنشاء', alphabetically: 'أبجديًا',
            accent: 'تمييز', goalProgressNotes: 'ملاحظة مكتملة نحو هذا الهدف',
            goalDelete: 'حذف الهدف', goalDone: 'تم تحقيق الهدف!', goalRemaining: 'متبقي',
            goalCreated: 'تم إنشاء الهدف', goalUpdated: 'تم تحديث الهدف', goalDeleted: 'تم حذف الهدف',
            noteProgress: '/ مكتمل',
        }
    };

    const i18n = {
        get lang() { return window.Mulhim && window.Mulhim.State && window.Mulhim.State.settings.lang === 'ar' ? 'ar' : 'en'; },
        t(key, params) {
            const dict = I18N[this.lang] || I18N.en;
            let str = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]
                : (Object.prototype.hasOwnProperty.call(I18N.en, key) ? I18N.en[key] : key);
            if (params) {
                Object.keys(params).forEach((k) => {
                    str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
                });
            }
            return str;
        },
        // Translate all elements marked with data-i18n
        apply(scope) {
            const root = scope || document;
            root.querySelectorAll('[data-i18n]').forEach((el) => {
                const key = el.getAttribute('data-i18n');
                el.textContent = this.t(key);
            });
            root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
                el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
            });
            root.querySelectorAll('[data-i18n-title]').forEach((el) => {
                el.title = this.t(el.getAttribute('data-i18n-title'));
            });
        }
    };

    // ---------- Export helper at module level ----------
    window.Mulhim = window.Mulhim || {};
    Object.assign(window.Mulhim, {
        Utils, DB, State, toast, confirmDialog, i18n
    });
})();