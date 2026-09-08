/* ============================================
   Mulhim — New pages: Tasks, Goals, Archive, Recent, Stats
   Loaded after app-core.js.
   ============================================ */
(function () {
    'use strict';
    const { Utils, DB, State, toast, confirmDialog, i18n } = window.Mulhim;
    const App = window.Mulhim.App;
    const T = (key, params) => i18n.t(key, params);

    /* ============================================
       Tasks View (aggregates all checklist items from live notes)
       ============================================ */
    App.renderTasks = async function () {
        const tagFilter = document.getElementById('tasksFilterTag');
        const statusFilter = document.getElementById('tasksFilterStatus');
        // Populate tag filter
        tagFilter.innerHTML = '<option value="">' + T('allTags') + '</option>';
        State.tags.forEach((t) => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = '#' + t.name;
            tagFilter.appendChild(opt);
        });
        if (!tagFilter._bound) {
            tagFilter._bound = true;
            tagFilter.addEventListener('change', runTasksRender);
            statusFilter.addEventListener('change', runTasksRender);
        }
        runTasksRender();
    };

    async function runTasksRender() {
        const tagFilter = document.getElementById('tasksFilterTag');
        const statusFilter = document.getElementById('tasksFilterStatus');
        const listEl = document.getElementById('tasksList');
        const emptyEl = document.getElementById('tasksEmpty');
        const fTag = tagFilter.value;
        const fStatus = statusFilter.value;

        let live = State.liveNotes();
        if (fTag) live = live.filter((n) => (n.tags || []).includes(fTag));

        const tasks = [];
        for (const note of live) {
            const html = await DB.getContent(note.id);
            if (!html) continue;
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const items = tmp.querySelectorAll('.checklist-item');
            items.forEach((li) => {
                const box = li.querySelector('input[type="checkbox"]');
                if (!box) return;
                const text = (li.querySelector('span') || li).textContent.trim();
                const done = box.checked;
                if (fStatus === 'pending' && done) return;
                if (fStatus === 'done' && !done) return;
                tasks.push({ note, text, done, li });
            });
        }

        listEl.innerHTML = '';
        if (!tasks.length) {
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';

        // group by note
        const groups = {};
        tasks.forEach((t) => {
            if (!groups[t.note.id]) groups[t.note.id] = { note: t.note, items: [] };
            groups[t.note.id].items.push(t);
        });

        Object.values(groups).forEach((grp) => {
            const section = document.createElement('div');
            section.className = 'task-group';
            const header = document.createElement('div');
            header.className = 'task-group-header';
            header.innerHTML = `<i class="fas fa-file-alt" style="color:var(--text-tertiary);"></i> <strong>${Utils.escapeHtml(grp.note.title || T('untitled'))}</strong>`;
            header.addEventListener('click', () => App.openEditor(grp.note.id));
            section.appendChild(header);

            grp.items.forEach((t) => {
                const item = document.createElement('div');
                item.className = 'task-item';
                item.innerHTML = `
                    <input type="checkbox" ${t.done ? 'checked' : ''}>
                    <span class="${t.done ? 'task-done' : ''}">${Utils.escapeHtml(t.text)}</span>
                    <button class="icon-btn task-note-link"><i class="fas fa-arrow-right" style="font-size:.7rem;"></i></button>`;
                const box = item.querySelector('input');
                box.addEventListener('change', async () => {
                    t.note.updatedAt = Date.now();
                    // Find and flip the matching checkbox in the stored content
                    const html = await DB.getContent(t.note.id);
                    const tmp = document.createElement('div');
                    tmp.innerHTML = html;
                    let found = 0;
                    tmp.querySelectorAll('.checklist-item input[type="checkbox"]').forEach((b) => {
                        const text = (b.closest('.checklist-item').querySelector('span') || b.closest('.checklist-item')).textContent.trim();
                        if (found === 0 && text === t.text && b.checked !== box.checked) {
                            b.checked = box.checked;
                            found++;
                        }
                    });
                    if (found) await DB.setContent(t.note.id, tmp.innerHTML);
                    // Simply reload the current state
                    runTasksRender();
                });
                item.querySelector('.task-note-link').addEventListener('click', (e) => {
                    e.stopPropagation();
                    App.openEditor(t.note.id);
                });
                section.appendChild(item);
            });
            listEl.appendChild(section);
        });
    }

    /* ============================================
       Goals View
       ============================================ */
    App.renderGoals = function () {
        const listEl = document.getElementById('goalsList');
        const emptyEl = document.getElementById('goalsEmpty');
        listEl.innerHTML = '';
        if (!State.goals.length) { emptyEl.style.display = 'block'; return; }
        emptyEl.style.display = 'none';

        State.goals.forEach((goal) => {
            const card = document.createElement('div');
            card.className = 'goal-card';
            const progress = Math.min(100, Math.round((goal.current / (goal.target || 1)) * 100));
            const done = progress >= 100;
            card.innerHTML = `
                <div class="goal-card-header">
                    <i class="fas ${done ? 'fa-check-circle' : 'fa-bullseye'}" style="color:${done ? 'var(--success)' : 'var(--accent)'}"></i>
                    <span class="goal-title ${done ? 'goal-done' : ''}">${Utils.escapeHtml(goal.title)}</span>
                    <div class="goal-actions">
                        <button class="icon-btn goal-edit"><i class="fas fa-pen"></i></button>
                        <button class="icon-btn goal-delete" style="color:var(--danger);"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="goal-progress-bar">
                    <div class="goal-progress-fill" style="width:${progress}%"></div>
                </div>
                <div class="goal-meta">
                    <span>${goal.current}/${goal.target}</span>
                    <span>${done ? T('goalDone') : (goal.target - goal.current) + ' ' + T('goalRemaining')}</span>
                </div>`;
            card.querySelector('.goal-delete').addEventListener('click', async () => {
                const ok = await confirmDialog(T('goalDelete') + '?', T('delete'));
                if (!ok) return;
                State.goals = State.goals.filter((g) => g.id !== goal.id);
                State.save();
                App.renderGoals();
                toast(T('goalDeleted'), 'info');
            });
            card.querySelector('.goal-edit').addEventListener('click', () => editGoal(goal));
            listEl.appendChild(card);
        });
    };

    function addGoalUI() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>${Utils.escapeHtml(T('addGoal'))}</h3>
                    <button class="icon-btn modal-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <label>${Utils.escapeHtml(T('goalTitle'))}</label>
                    <input type="text" id="goalNameInput" placeholder="${Utils.escapeHtml(T('goalTitle'))}" autocomplete="off">
                    <label>${Utils.escapeHtml(T('goalTarget'))}</label>
                    <input type="number" id="goalTargetInput" value="10" min="1" autocomplete="off">
                </div>
                <div class="modal-footer">
                    <button class="secondary-btn modal-close">${Utils.escapeHtml(T('cancel'))}</button>
                    <button class="primary-btn" id="goalSaveBtn">${Utils.escapeHtml(T('save'))}</button>
                </div>
            </div>`;
        overlay.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', () => overlay.remove()));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        overlay.querySelector('#goalSaveBtn').addEventListener('click', () => {
            const title = overlay.querySelector('#goalNameInput').value.trim();
            const target = parseInt(overlay.querySelector('#goalTargetInput').value) || 10;
            if (!title) return;
            State.goals.push({ id: Utils.uid(), title, target, current: 0, createdAt: Date.now() });
            State.save();
            overlay.remove();
            App.renderGoals();
        toast(T('goalCreated'), 'success');
        });
    }

    function editGoal(goal) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>${Utils.escapeHtml(T('edit'))}: ${Utils.escapeHtml(goal.title)}</h3>
                    <button class="icon-btn modal-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <label>${Utils.escapeHtml(T('goalTitle'))}</label>
                    <input type="text" id="goalNameInput" value="${Utils.escapeHtml(goal.title)}" autocomplete="off">
                    <label>${Utils.escapeHtml(T('goalTarget'))}</label>
                    <input type="number" id="goalTargetInput" value="${goal.target}" min="1" autocomplete="off">
                    <label>${Utils.escapeHtml(T('goalProgressNotes'))} (${goal.current})</label>
                    <input type="number" id="goalCurrentInput" value="${goal.current}" min="0" autocomplete="off">
                </div>
                <div class="modal-footer">
                    <button class="secondary-btn modal-close">${Utils.escapeHtml(T('cancel'))}</button>
                    <button class="primary-btn" id="goalSaveBtn">${Utils.escapeHtml(T('save'))}</button>
                </div>
            </div>`;
        overlay.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', () => overlay.remove()));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        overlay.querySelector('#goalSaveBtn').addEventListener('click', () => {
            const title = overlay.querySelector('#goalNameInput').value.trim();
            const target = parseInt(overlay.querySelector('#goalTargetInput').value) || 10;
            const current = parseInt(overlay.querySelector('#goalCurrentInput').value) || 0;
            if (!title) return;
            goal.title = title;
            goal.target = target;
            goal.current = current;
            State.save();
            overlay.remove();
            App.renderGoals();
            toast(T('goalUpdated'), 'success');
        });
    }

    /* ============================================
       Archive View
       ============================================ */
    App.renderArchive = function () {
        const listEl = document.getElementById('archiveList');
        const emptyEl = document.getElementById('archiveEmpty');
        const archived = State.notes.filter((n) => n.isArchived && !n.deletedAt);
        listEl.innerHTML = '';
        if (!archived.length) { emptyEl.style.display = 'block'; return; }
        emptyEl.style.display = 'none';
        archived.sort((a, b) => b.updatedAt - a.updatedAt).forEach((n) => {
            const item = document.createElement('div');
            item.className = 'trash-item';
            const tagHtml = State.noteTags(n).slice(0, 3).map((t) =>
                `<span class="mini-tag" style="background:${Utils.escapeHtml(t.color)}22;color:${Utils.escapeHtml(t.color)}">${Utils.escapeHtml(t.name)}</span>`
            ).join(' ');
            item.innerHTML = `
                <i class="fas fa-archive" style="color:var(--text-tertiary);"></i>
                <div class="trash-info">
                    <div class="trash-title">${Utils.escapeHtml(n.title || T('untitled'))}</div>
                    <div class="trash-date">${Utils.timeAgo(n.updatedAt)} ${tagHtml}</div>
                </div>
                <div class="trash-actions">
                    <button class="secondary-btn restore-btn"><i class="fas fa-undo"></i> ${Utils.escapeHtml(T('unarchive'))}</button>
                    <button class="danger-btn purge-btn"><i class="fas fa-trash"></i></button>
                </div>`;
            item.querySelector('.restore-btn').addEventListener('click', () => {
                n.isArchived = false;
                n.updatedAt = Date.now();
                State.save();
                App.renderArchive();
                App.renderSidebar();
                toast(T('noteUnarchived'), 'success');
            });
            item.querySelector('.purge-btn').addEventListener('click', () => App.purgeNote(n.id));
            listEl.appendChild(item);
        });
    };

    /* ============================================
       Recently Opened View
       ============================================ */
    App.renderRecent = function () {
        const listEl = document.getElementById('recentList');
        const emptyEl = document.getElementById('recentEmpty');
        const live = State.liveNotes();
        const recent = live.filter((n) => n.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
        listEl.innerHTML = '';
        if (!recent.length) { emptyEl.style.display = 'block'; return; }
        emptyEl.style.display = 'none';
        recent.slice(0, 30).forEach((n) => {
            const item = document.createElement('div');
            item.className = 'recent-item';
            const tagHtml = State.noteTags(n).slice(0, 2).map((t) =>
                `<span class="mini-tag" style="background:${Utils.escapeHtml(t.color)}22;color:${Utils.escapeHtml(t.color)}">#${Utils.escapeHtml(t.name)}</span>`
            ).join(' ');
            item.innerHTML = `
                <i class="far fa-clock" style="color:var(--text-tertiary);"></i>
                <div class="trash-info">
                    <div class="trash-title">${Utils.escapeHtml(n.title || T('untitled'))}</div>
                    <div class="trash-date">${Utils.timeAgo(n.lastOpenedAt)} ${tagHtml}</div>
                </div>
                <button class="icon-btn"><i class="fas fa-arrow-right" style="font-size:.7rem;"></i></button>`;
            item.addEventListener('click', () => App.openEditor(n.id));
            listEl.appendChild(item);
        });
    };

    /* ============================================
       Stats View
       ============================================ */
    App.renderStats = async function () {
        const live = State.liveNotes();
        const archived = State.notes.filter((n) => n.isArchived && !n.deletedAt);
        document.getElementById('statTotalNotes').textContent = live.length;
        let totalWords = 0, totalTasks = 0, completedTasks = 0;
        let totalLinks = 0;
        const tagUsage = {};
        const contents = await Promise.all(live.map(async (n) => ({ n, html: await DB.getContent(n.id) })));
        contents.forEach(({ n, html }) => {
            const text = Utils.stripHtml(html);
            totalWords += Utils.wordCount(text);
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            tmp.querySelectorAll('.checklist-item input[type="checkbox"]').forEach((b) => {
                totalTasks++;
                if (b.checked) completedTasks++;
            });
            const links = (html.match(/data-note="[^"]+"/g) || []).length;
            totalLinks += links;
            (n.tags || []).forEach((tid) => { tagUsage[tid] = (tagUsage[tid] || 0) + 1; });
        });
        document.getElementById('statTotalWords').textContent = totalWords.toLocaleString();
        document.getElementById('statCompletedTasks').textContent = completedTasks + '/' + totalTasks;
        document.getElementById('statLinks').textContent = totalLinks;
        // Top tags
        const tagBox = document.getElementById('statTopTags');
        tagBox.innerHTML = '';
        Object.entries(tagUsage).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([tid, count]) => {
            const tag = State.getTag(tid);
            if (!tag) return;
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<span class="tag-dot" style="width:10px;height:10px;border-radius:50%;background:${Utils.escapeHtml(tag.color)};display:inline-block;"></span> #${Utils.escapeHtml(tag.name)}<span style="margin-left:auto;font-size:.75rem;color:var(--text-tertiary);">${count}</span>`;
            tagBox.appendChild(el);
        });
        if (!Object.keys(tagUsage).length) tagBox.innerHTML = `<p style="color:var(--text-tertiary);font-size:.9rem;">${T('noTagsYet')}</p>`;
        // Recent notes
        const recentBox = document.getElementById('statRecentNotes');
        recentBox.innerHTML = '';
        live.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).forEach((n) => {
            const el = document.createElement('div');
            el.className = 'backlink-item';
            el.innerHTML = `<i class="fas fa-file-alt" style="color:var(--text-secondary);font-size:.8rem;"></i> ${Utils.escapeHtml(n.title || T('untitled'))}<span style="margin-left:auto;font-size:.75rem;color:var(--text-tertiary);">${Utils.timeAgo(n.updatedAt)}</span>`;
            el.addEventListener('click', () => App.openEditor(n.id));
            recentBox.appendChild(el);
        });
        if (!live.length) recentBox.innerHTML = `<p style="color:var(--text-tertiary);font-size:.9rem;">${T('noNotesYet')}</p>`;
    };

    /* ============================================
       Wire up goal button + task filter init
       ============================================ */
    document.addEventListener('DOMContentLoaded', () => {
        const goalBtn = document.getElementById('addGoalBtn');
        if (goalBtn) goalBtn.addEventListener('click', addGoalUI);
    });
})();
