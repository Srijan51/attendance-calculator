// Register Chart.js datalabels plugin
// Wrap in try-catch in case Chart or plugin isn't loaded
try {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    } else {
        console.warn("Chart.js or ChartDataLabels plugin not found. Charts may not render correctly.");
    }
} catch (e) {
    console.error("Error registering ChartDataLabels plugin:", e);
}


const WEEKS = 4;
// Note: JS Date.getDay() is 0-indexed (Sun=0, Mon=1), but our array is Mon=0.
// This new array matches the Date.getDay() index for easier lookups.
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Original DAYS array (Monday-first) for logic that uses it
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Default subject colors
const DEFAULT_COLORS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5856d6', '#ff2d55', '#ffcc00'];

let timetable = {}; // { week: { day: [subjectName, ...] } }
let subjectsMaster = {}; // { subjectName: { color: '#...', icon: '🧪' } }
let attendance = []; // { week, day, date, month, subjects: [{ name, attended }], note: '...' }
let monthlyHistory = [];
let currentMonthName = null;
let attendanceChart = null; // Variable to hold the chart instance

// --- Core Data Handling ---

function saveToLocal() {
    try {
        localStorage.setItem('attendance_timetable', JSON.stringify(timetable));
        localStorage.setItem('attendance_subjects_master', JSON.stringify(subjectsMaster)); // Save master list
        localStorage.setItem('attendance_data', JSON.stringify(attendance));
        localStorage.setItem('attendance_monthly_history', JSON.stringify(monthlyHistory));
        localStorage.setItem('attendance_current_month', currentMonthName || '');
        // Goal & Accent & Theme are saved directly by their event listeners
    } catch (e) {
        console.error("Error saving data to localStorage:", e);
        showNotification("Could not save data. Local storage might be full or disabled.", "error", null, "Save Error");
    }
}

function loadFromLocal() {
    try {
        timetable = JSON.parse(localStorage.getItem('attendance_timetable') || '{}');
        subjectsMaster = JSON.parse(localStorage.getItem('attendance_subjects_master') || '{}');
        attendance = JSON.parse(localStorage.getItem('attendance_data') || '[]');
        monthlyHistory = JSON.parse(localStorage.getItem('attendance_monthly_history') || '[]');
        currentMonthName = localStorage.getItem('attendance_current_month') || null;

        // Load goal setting
        const goalInput = document.getElementById('attendance-goal-input');
        if (goalInput) {
            goalInput.value = localStorage.getItem('attendance_goal') || '75';
        }

        // --- MIGRATION (Handle older data formats) ---
        migrateOldData();
        // --- END MIGRATION ---

    } catch (e) {
        console.error("Error loading data from localStorage:", e);
        showNotification("Could not load saved data. It might be corrupted. Starting fresh.", "error", null, "Load Error");
        // Reset to defaults if loading fails
        timetable = {}; subjectsMaster = {}; attendance = []; monthlyHistory = []; currentMonthName = null;
    }
}

// Function to handle migration from older string-based subject storage
function migrateOldData() {
    let needsSave = false;
    try {
        // Migrate timetable (if it's flat)
        if (!timetable['1'] && Object.keys(timetable).length > 0 && !Array.isArray(timetable)) { // Added check for array
            console.log("Migrating old timetable format...");
            const oldTimetable = JSON.parse(JSON.stringify(timetable));
            timetable = { '1': {}, '2': {}, '3': {}, '4': {} };
            DAYS.forEach(day => {
                if (oldTimetable[day] && Array.isArray(oldTimetable[day])) {
                     const subjectNames = oldTimetable[day].map(s => typeof s === 'object' ? s.name : s).filter(Boolean); // Filter out empty/null
                     for (let w = 1; w <= WEEKS; w++) { timetable[w][day] = [...subjectNames]; }
                     subjectNames.forEach(name => { if (name && !subjectsMaster[name]) { addSubjectToMaster(name); } });
                } else {
                     for (let w = 1; w <= WEEKS; w++) { timetable[w][day] = []; }
                }
            });
            needsSave = true;
        } else {
            // Ensure all weeks/days exist and check master
            for (let w = 1; w <= WEEKS; w++) {
                if (!timetable[w]) timetable[w] = {};
                DAYS.forEach(day => {
                    if (!timetable[w][day]) timetable[w][day] = [];
                    timetable[w][day].forEach(name => { if (name && !subjectsMaster[name]) addSubjectToMaster(name); })
                });
            }
        }

        // Migrate attendance data
        const migrateEntrySubjects = (entry) => {
             let migrated = false;
             if (entry && entry.subjects && entry.subjects.length > 0 && (typeof entry.subjects[0] !== 'object' || !entry.subjects[0]?.hasOwnProperty('attended'))) {
                console.log("Migrating old attendance subject format...");
                entry.subjects = entry.subjects.map(subj => {
                    const name = typeof subj === 'object' ? subj.name : subj;
                    if (typeof name !== 'string' || !name.trim()) return null; // Skip invalid subject data
                    const attended = typeof subj === 'object' ? subj.attended : true;
                    if (!subjectsMaster[name]) addSubjectToMaster(name);
                    return { name: name, attended: attended };
                }).filter(Boolean); // Remove null entries from invalid data
                migrated = true;
             } else if (entry && entry.subjects) {
                entry.subjects.forEach(subj => { if (subj && subj.name && !subjectsMaster[subj.name]) addSubjectToMaster(subj.name); });
             }
             return migrated;
        };

        if(Array.isArray(attendance)) {
            attendance.forEach(entry => { if (migrateEntrySubjects(entry)) needsSave = true; });
        } else { attendance = []; needsSave = true;} // Handle corrupted attendance

        if(Array.isArray(monthlyHistory)) {
            monthlyHistory.forEach(month => { month.attendance?.forEach(entry => { if (migrateEntrySubjects(entry)) needsSave = true; }); });
        } else { monthlyHistory = []; needsSave = true; } // Handle corrupted history

        if (needsSave) {
            console.log("Migration complete. Saving updated data.");
            saveToLocal();
        }
    } catch (e) {
        console.error("Error during data migration:", e);
        // Don't save potentially corrupted data after failed migration attempt
    }
}

// Helper to add a subject to the master list
function addSubjectToMaster(name) {
    if (!name || typeof name !== 'string' || !name.trim() || subjectsMaster[name]) return; // Extra validation
    const existingColors = Object.values(subjectsMaster).map(s => s.color);
    let colorIndex = Object.keys(subjectsMaster).length % DEFAULT_COLORS.length;
    let attempts = 0;
    while (existingColors.filter(c => c === DEFAULT_COLORS[colorIndex]).length > 1 && attempts < DEFAULT_COLORS.length) {
       colorIndex = (colorIndex + 1) % DEFAULT_COLORS.length;
       attempts++;
    }
    subjectsMaster[name] = { color: DEFAULT_COLORS[colorIndex], icon: '' };
    console.log(`Added "${name}" to master list.`);
}


// --- Timetable Setup ---

function createTimetableInputs() {
    renderSubjectMasterList();
    for (let w = 1; w <= WEEKS; w++) {
        const container = document.getElementById(`days-container-${w}`);
        if (!container) continue; // Safety check
        container.innerHTML = '';
        DAYS.forEach(day => {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'day-input-group';
            // Ensure timetable[w] and timetable[w][day] exist before join
            const subjectsString = (timetable[w]?.[day] || []).join(', ');
            dayDiv.innerHTML = `<label for="${w}-${day}">${day}:</label>
                               <input type="text" placeholder="Subjects (comma separated)" id="${w}-${day}" value="${subjectsString}">`;
            container.appendChild(dayDiv);
        });
    }
    setupTimetableTabs(); // Setup tab switching
}

function setupTimetableTabs() {
    const tabLinks = document.querySelectorAll('#timetable-setup .tab-link');
    const tabContents = document.querySelectorAll('#timetable-setup .tab-content');
    if (!tabLinks.length || !tabContents.length) return; // Exit if elements not found

    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const week = link.dataset.week;
            tabLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            link.classList.add('active');
            const content = document.getElementById(`days-container-${week}`);
            if (content) content.classList.add('active');
        });
    });
}

function renderSubjectMasterList() {
    const container = document.getElementById('subject-master-list');
    if (!container) return; // Safety check
    container.innerHTML = '';
    const sortedNames = Object.keys(subjectsMaster).sort();

    if (sortedNames.length === 0) {
        container.innerHTML = '<p>Subjects will appear here once you add them to the timetable below.</p>';
        return;
    }

    sortedNames.forEach(name => {
        const subject = subjectsMaster[name];
        if (!subject || typeof subject.color === 'undefined') {
             console.warn(`Subject "${name}" missing data in master list. Re-adding with defaults.`);
             addSubjectToMaster(name); // Try to fix it
             if (!subjectsMaster[name]) return; // Skip if still broken
             subject = subjectsMaster[name];
        }

        const div = document.createElement('div');
        div.className = 'subject-master-item';
        div.innerHTML = `
            <input type="color" value="${subject.color}" data-subject="${name}" class="subject-color-input">
            <input type="text" value="${subject.icon || ''}" data-subject="${name}" class="subject-icon-input" placeholder="Icon (e.g., 📚)" maxlength="2">
            <span class="subject-master-name">${name}</span>
            <button type="button" class="delete-subject-btn" data-subject="${name}" title="Remove Subject Everywhere">&times;</button>
        `;
        container.appendChild(div);
    });
    attachMasterListListeners(); // Attach listeners separately
}

function attachMasterListListeners() {
    const container = document.getElementById('subject-master-list');
    if (!container) return;
    // Debounce function to limit rapid saves
    const debounce = (func, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };
    const debouncedSave = debounce(saveToLocal, 300); // Save after 300ms of inactivity

    container.querySelectorAll('.subject-color-input').forEach(input => {
        input.addEventListener('change', (e) => { // 'change' is better for color pickers
            const subjName = e.target.dataset.subject;
            if (subjectsMaster[subjName]) {
                 subjectsMaster[subjName].color = e.target.value;
                 saveToLocal(); // Save immediately on change
                 updateUIColors();
            }
        });
    });
    container.querySelectorAll('.subject-icon-input').forEach(input => {
        input.addEventListener('input', (e) => { // 'input' for icons
             const subjName = e.target.dataset.subject;
             if (subjectsMaster[subjName]) {
                 subjectsMaster[subjName].icon = e.target.value;
                 debouncedSave(); // Debounce icon saves
                 updateUIColors();
             }
        });
    });
     container.querySelectorAll('.delete-subject-btn').forEach(button => {
        button.addEventListener('click', handleDeleteSubject);
    });
}

// Helper to update UI elements that use subject colors/icons
function updateUIColors() {
    if (document.getElementById('results')?.style.display === 'block') {
         showCompleteAttendance(); showAttendanceTable();
    }
    if (document.getElementById('attendance-mark')?.style.display === 'block') {
         showAttendanceForm();
    }
}

function saveTimetable(e) {
    e.preventDefault();
    timetable = { '1': {}, '2': {}, '3': {}, '4': {} };
    const newMasterSubjects = new Set();

    for (let w = 1; w <= WEEKS; w++) {
        DAYS.forEach(day => {
            const inputEl = document.getElementById(`${w}-${day}`);
            const inputVal = inputEl ? inputEl.value.trim() : '';
            const subjectNames = inputVal ? inputVal.split(',').map(s => s.trim()).filter(Boolean) : [];
            timetable[w][day] = subjectNames;
            subjectNames.forEach(name => { if(name) { addSubjectToMaster(name); newMasterSubjects.add(name); } });
        });
    }

    saveToLocal();
    renderSubjectMasterList();
    document.getElementById('timetable-setup').style.display = 'none';
    createPreviousAttendanceInputs();
}

function handleDeleteSubject(e) {
     const subjectName = e.target.dataset.subject;
     if (!subjectName) return;
     showNotification(
        `Delete "${subjectName}"? It will be removed from all timetables and past records. Cannot be undone.`, 'confirm', () => {
            delete subjectsMaster[subjectName];
            for (let w = 1; w <= WEEKS; w++) { DAYS.forEach(day => { if (timetable[w]?.[day]) { timetable[w][day] = timetable[w][day].filter(name => name !== subjectName); } }); }
            attendance.forEach(entry => { entry.subjects = entry.subjects?.filter(subj => subj.name !== subjectName); });
            attendance = attendance.filter(entry => entry.subjects?.length > 0 || entry.note);
            monthlyHistory.forEach(month => { month.attendance?.forEach(entry => { entry.subjects = entry.subjects?.filter(subj => subj.name !== subjectName); }); month.attendance = month.attendance?.filter(entry => entry.subjects?.length > 0 || entry.note); });
            saveToLocal();
            createTimetableInputs(); // Rebuild timetable UI
            updateUIAfterDelete(); // Update other relevant UI parts
            showNotification(`Subject "${subjectName}" deleted.`, 'success');
        }, 'Confirm Deletion'
     );
}

// Helper to update UI after subject deletion
function updateUIAfterDelete() {
     if (document.getElementById('results')?.style.display === 'block' || currentMonthName) { showResults(); }
     if (document.getElementById('attendance-mark')?.style.display === 'block') { showAttendanceForm(); }
     if (document.getElementById('projections')?.style.display === 'block') { populateProjectionSubjects(); }
}


// --- Previous Attendance ---

function getUniqueSubjectNamesFromTimetable() {
    const allSubjectNames = new Set();
     for (let w = 1; w <= WEEKS; w++) {
        if (!timetable[w]) continue;
        Object.values(timetable[w]).flat().forEach(name => {
            if (name) allSubjectNames.add(name);
        });
    }
    return [...allSubjectNames].sort();
}

function createPreviousAttendanceInputs() {
    const container = document.getElementById('previous-subjects-container');
    if (!container) return;
    container.innerHTML = '';
    const subjectNames = getUniqueSubjectNamesFromTimetable();

    if (subjectNames.length === 0) {
        showMonthControls();
        return;
    }

    subjectNames.forEach(name => {
        const subjectMeta = subjectsMaster[name] || { icon: '', color: '#cccccc' };
        const div = document.createElement('div');
        div.className = 'previous-subject-entry';
        div.innerHTML = `
            <h3><span class="subject-icon">${subjectMeta.icon || ''}</span> ${name}</h3>
            <div class="input-group">
                <div> <label for="prev-attended-${name}">Attended</label> <input type="number" id="prev-attended-${name}" min="0" value="0"> </div>
                <div> <label for="prev-total-${name}">Total Held</label> <input type="number" id="prev-total-${name}" min="0" value="0"> </div>
            </div>`;
         div.querySelector('h3').style.borderLeft = `5px solid ${subjectMeta.color}`;
         div.querySelector('h3').style.paddingLeft = '10px';
        container.appendChild(div);
    });
    document.getElementById('previous-attendance-setup').style.display = 'block';
}

function savePreviousAttendance(e) {
    e.preventDefault();
    const subjectNames = getUniqueSubjectNamesFromTimetable();
    let previousSubjects = [];
    let hasErrors = false;

    for (const name of subjectNames) {
        const attendedInput = document.getElementById(`prev-attended-${name}`);
        const totalInput = document.getElementById(`prev-total-${name}`);
        if (!attendedInput || !totalInput) { continue; }

        const attended = parseInt(attendedInput.value) || 0;
        const total = parseInt(totalInput.value) || 0;

        if (attended < 0 || total < 0) { showNotification(`For ${name}, attended/total cannot be negative.`, 'error'); hasErrors = true; break; }
        if (attended > total) { showNotification(`For ${name}, attended (${attended}) > total (${total}).`, 'error'); hasErrors = true; break; }

        const missed = total - attended;
        for (let i = 0; i < attended; i++) { previousSubjects.push({ name: name, attended: true }); }
        for (let i = 0; i < missed; i++) { previousSubjects.push({ name: name, attended: false }); }
    }

    if (hasErrors) return;

    monthlyHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data");

    if (previousSubjects.length > 0) {
        const previousEntry = { week: 0, day: 'N/A', date: 'N/A', month: 'Previous Data', subjects: previousSubjects, note: "Baseline data" };
        monthlyHistory.push({ monthName: "Previous Data", attendance: [previousEntry] });
    } else if (!monthlyHistory.some(m => m.monthName === "Previous Data")) {
         monthlyHistory.push({ monthName: "Previous Data", attendance: [] });
    }

    saveToLocal();
    document.getElementById('previous-attendance-setup').style.display = 'none';
    showMonthControls();
    showNotification('Previous attendance saved.', 'success');
    showResults();
}

function skipPreviousAttendance() {
     if (!monthlyHistory.some(m => m.monthName === "Previous Data")) {
         monthlyHistory.push({ monthName: "Previous Data", attendance: [] });
         saveToLocal();
     }
    document.getElementById('previous-attendance-setup').style.display = 'none';
    showMonthControls();
}


// --- Month Controls & Attendance Marking ---

function showMonthControls() {
    const controls = document.getElementById('month-controls');
    const newMonthBtn = document.getElementById('new-month-btn');
    const newMonthForm = document.getElementById('new-month-form');
    const monthNameInput = document.getElementById('month-name-input');
    if (!controls || !newMonthBtn || !newMonthForm || !monthNameInput) return; // Safety check

    controls.style.display = 'block';
    updateMonthLabel();

    newMonthBtn.onclick = () => {
        newMonthForm.style.display = 'flex';
        monthNameInput.value = '';
        monthNameInput.focus();
    };

    newMonthForm.onsubmit = (e) => {
        e.preventDefault();
        const name = monthNameInput.value.trim();
        if (!name) return;
        if (currentMonthName && attendance.length > 0) {
             monthlyHistory.push({ monthName: currentMonthName, attendance: JSON.parse(JSON.stringify(attendance)) });
        }
        currentMonthName = name;
        attendance = [];
        saveToLocal();
        updateMonthLabel();
        newMonthForm.style.display = 'none';
        document.getElementById('attendance-mark').style.display = 'block';
        showAttendanceForm();
        showResults();
        showProjectionsCard();
    };
}

function updateMonthLabel() {
    const label = document.getElementById('current-month-label');
    const attendanceMarkSection = document.getElementById('attendance-mark');
    if (!label || !attendanceMarkSection) return;

    label.textContent = currentMonthName ? `Current Month: ${currentMonthName}` : 'No month started';
    attendanceMarkSection.style.display = currentMonthName ? 'block' : 'none';
}

function showAttendanceForm() {
    const selectorsDiv = document.getElementById('week-day-selectors');
    const noteInput = document.getElementById('attendance-note');
    if (!selectorsDiv || !noteInput) return;
    selectorsDiv.innerHTML = '';

    const weekLabel = document.createElement('label'); weekLabel.htmlFor = 'attendance-week-select'; weekLabel.textContent = 'Week:';
    const weekSelect = document.createElement('select'); weekSelect.id = 'attendance-week-select';
    for (let w = 1; w <= WEEKS; w++) { weekSelect.add(new Option(`Week ${w}`, w)); }

    const dayLabel = document.createElement('label'); dayLabel.htmlFor = 'attendance-day-select'; dayLabel.textContent = 'Day:';
    const daySelect = document.createElement('select'); daySelect.id = 'attendance-day-select';
    DAYS.forEach(day => { daySelect.add(new Option(day, day)); });

    const dateLabel = document.createElement('label'); dateLabel.htmlFor = 'attendance-date'; dateLabel.textContent = 'Date:';
    const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.id = 'attendance-date';

    const weekWrapper = document.createElement('div'); weekWrapper.append(weekLabel, weekSelect);
    const dayWrapper = document.createElement('div'); dayWrapper.append(dayLabel, daySelect);
    const dateWrapper = document.createElement('div'); dateWrapper.append(dateLabel, dateInput);
    selectorsDiv.append(weekWrapper, dayWrapper, dateWrapper);

    const renderSubjects = () => {
        const todayDiv = document.getElementById('today-classes');
        if (!todayDiv) return;
        todayDiv.innerHTML = '';
        const week = weekSelect.value;
        const day = daySelect.value;
        todayDiv.innerHTML = `<h3>${day}</h3>`;

        const subjectNames = timetable[week]?.[day] || [];
        const uniqueSubjectNames = [...new Set(subjectNames)];
        const existingEntry = attendance.find(entry => entry.week == week && entry.day === day);
        noteInput.value = existingEntry?.note || '';

        if (!uniqueSubjectNames.length) {
            todayDiv.innerHTML = '<p class="empty-state-message">No classes scheduled for this day.</p>';
        } else {
            uniqueSubjectNames.forEach(name => {
                const subjectMeta = subjectsMaster[name] || { icon: '', color: '#ccc' };
                const isChecked = existingEntry?.subjects?.find(s => s.name === name)?.attended || false;
                const label = document.createElement('label');
                label.className = 'subject-checkbox-label';
                label.innerHTML = `<input type="checkbox" name="subject" value="${name}" ${isChecked ? 'checked' : ''}> <span class="subject-icon">${subjectMeta.icon || ''}</span> <span>${name}</span>`;
                label.style.setProperty('--subject-color', subjectMeta.color);
                if (isChecked) label.classList.add('checked');
                label.querySelector('input').addEventListener('change', (e) => label.classList.toggle('checked', e.target.checked));
                todayDiv.appendChild(label);
            });
        }
    };

    weekSelect.addEventListener('change', renderSubjects);
    daySelect.addEventListener('change', renderSubjects);
    dateInput.addEventListener('change', (e) => {
        const date = e.target.value; if (!date) return;
        try { // Add try-catch for date parsing
            const [year, month, dayOfMonth] = date.split('-');
            const localDate = new Date(year, month - 1, dayOfMonth);
            const dayName = DAYS_OF_WEEK[localDate.getDay()];
            const calculatedWeek = Math.min(Math.ceil(dayOfMonth / 7), WEEKS);
            weekSelect.value = calculatedWeek;
            daySelect.value = dayName;
            renderSubjects();
        } catch (dateError) {
            console.error("Error processing date input:", dateError);
        }
    });

    const today = new Date();
    const dayName = DAYS_OF_WEEK[today.getDay()];
    const dayOfMonth = today.getDate();
    const calculatedWeek = Math.min(Math.ceil(dayOfMonth / 7), WEEKS);
    weekSelect.value = calculatedWeek;
    daySelect.value = dayName;
    dateInput.valueAsDate = today;

    renderSubjects();
}

function submitAttendance(e) {
    e.preventDefault();
    if (!currentMonthName) { showNotification('Please start a new month first.', 'info'); return; }

    const week = parseInt(document.getElementById('attendance-week-select')?.value);
    const day = document.getElementById('attendance-day-select')?.value;
    const date = document.getElementById('attendance-date')?.value;
    const note = document.getElementById('attendance-note')?.value.trim();
    // Safety check for week/day selectors
    if (isNaN(week) || !day) {
        showNotification('Error: Could not read week/day selection.', 'error');
        return;
    }

    const subjectsFromTimetable = timetable[week]?.[day] || [];
    const attendedNames = Array.from(document.querySelectorAll('#today-classes input[name="subject"]:checked')).map(cb => cb.value);

    const newSubjectsData = subjectsFromTimetable.map(name => ({ name, attended: attendedNames.includes(name) })).filter(s => s.name && subjectsMaster[s.name]); // Ensure subject still exists

    if (newSubjectsData.length === 0 && !note) {
         showNotification('No subjects marked or note added for this day.', 'info', null, 'Nothing to Save');
         return;
    }

    const existingEntryIndex = attendance.findIndex(entry => entry.week === week && entry.day === day);

    if (existingEntryIndex > -1) {
        attendance[existingEntryIndex].subjects = newSubjectsData;
        attendance[existingEntryIndex].note = note;
        if (date) attendance[existingEntryIndex].date = date;
    } else {
        attendance.push({ week, day, date, month: currentMonthName, subjects: newSubjectsData, note: note });
    }
    saveToLocal();
    showResults();
    showNotification('Attendance saved.', 'success');
}


// --- Results Display ---

function showResults() {
    const resultsSection = document.getElementById('results');
    if (!resultsSection) return;
    resultsSection.style.display = 'block';
    showAttendanceTable();
    showAllMonthsAttendance();
    showCompleteAttendance();
    populateProjectionSubjects(); // Update projection dropdown
}

function showAttendanceTable() {
    const container = document.getElementById('attendance-table-container');
    if (!container) return;
    container.innerHTML = '<h3>Current Month Attendance</h3>';
    let tableHTML = `<table class="attendance-table"><thead><tr><th>Week</th><th>Date</th><th>Day</th><th>Subjects</th><th>Note</th></tr></thead><tbody>`;
    const sortedAttendance = [...attendance].sort((a, b) => {
        if (a.week !== b.week) return a.week - b.week;
        return DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    });

    sortedAttendance.forEach(entry => {
        tableHTML += `<tr>
            <td>${entry.week}</td>
            <td>${entry.date || ''}</td>
            <td>${entry.day}</td>
            <td>${entry.subjects?.map(s => {
                if (!s || !s.name) return '';
                const subjectMeta = subjectsMaster[s.name] || { icon: '', color: '#ccc'};
                const cellClass = s.attended ? 'subject-cell-attended' : 'subject-cell-missed';
                return `<span class="subject-cell ${cellClass}" style="--subject-color: ${subjectMeta.color};"><span class="subject-icon">${subjectMeta.icon || ''}</span> ${s.name}</span>`;
            }).join('') || '<span class="no-subjects-note">No scheduled classes</span>'}</td>
            <td class="attendance-note-cell">${entry.note || ''}</td>
        </tr>`;
    });
    tableHTML += '</tbody></table>';

    if (sortedAttendance.length === 0) {
        container.innerHTML += `<div class="empty-state"><svg class="empty-state-visual" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg><p>No attendance marked for this month yet.</p></div>`;
    } else {
        container.innerHTML += tableHTML;
    }
}

function showAllMonthsAttendance() {
    const container = document.getElementById('all-months-attendance');
    if (!container) return;
    container.innerHTML = '<h3>Previous Months</h3>';
    const visibleHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data");

    if (!visibleHistory.length) {
        container.innerHTML += `<div class="empty-state"><svg class="empty-state-visual" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg><p>No previous months stored.</p></div>`;
        return;
    }

    visibleHistory.forEach(monthEntry => {
        container.innerHTML += `<h4>${monthEntry.monthName}</h4>`;
        let subjectTotals = {};
        monthEntry.attendance?.forEach(entry => { entry.subjects?.forEach(s => { if(s && s.name && subjectsMaster[s.name]){ if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0}; subjectTotals[s.name].total += 1; if (s.attended) subjectTotals[s.name].attended += 1; }}); });
        container.innerHTML += '<ul>';
        Object.keys(subjectTotals).sort().forEach(name => {
            const {attended, total} = subjectTotals[name];
            const percent = total ? ((attended / total)* 100).toFixed(2) : 'N/A';
            container.innerHTML += `<li>${name}: ${attended}/${total} (${percent}%)</li>`;
        });
        container.innerHTML += '</ul>';
    });
}

function showCompleteAttendance() {
    const container = document.getElementById('complete-attendance');
    const listDiv = document.getElementById('complete-attendance-list');
    const chartContainer = document.getElementById('chart-container');
    if (!container || !listDiv || !chartContainer) return;
    container.style.display = 'block'; listDiv.innerHTML = '';

    let subjectTotals = calculateSubjectTotals();
    let grandTotal = 0, grandAttended = 0;
    Object.values(subjectTotals).forEach(s => { grandTotal += s.total; grandAttended += s.attended; });
    const overallAverage = (grandTotal > 0) ? (grandAttended / grandTotal) * 100 : 0;

    if (Object.keys(subjectTotals).length === 0) {
        listDiv.innerHTML = `<div class="empty-state"><svg class="empty-state-visual" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zm0-8h14V7H7v2z"/></svg><p>Your attendance data will appear here.</p></div>`;
        chartContainer.style.display = 'none'; return;
    }

    chartContainer.style.display = 'block';
    let listHTML = '<ul>';
    const goalPercent = parseFloat(localStorage.getItem('attendance_goal')) || 75;
    const goal = goalPercent / 100.0;
    let chartLabels = [], chartData = [], chartColors = [];

    Object.keys(subjectTotals).sort().forEach(name => {
        const { attended, total } = subjectTotals[name];
        const subjectMeta = subjectsMaster[name] || { icon: '', color: '#ccc'};
        const percentNum = total ? (attended / total) * 100 : 0;
        const percent = percentNum.toFixed(2);
        let bunkerInfo = '', barColorClass = 'bar-primary';

        if (total === 0) { bunkerInfo = '<span class="bunker-info">No classes recorded yet.</span>'; barColorClass = 'bar-neutral'; }
        else if (percentNum >= goalPercent) {
             const bunksAvailable = (goal > 0) ? Math.floor((attended - (goal * total)) / goal) : Infinity; // Avoid division by zero if goal is 0
             bunkerInfo = `<span class="bunker-info bunks-available">Can miss ${bunksAvailable} class${bunksAvailable !== 1 ? 'es' : ''}.</span>`;
             barColorClass = 'bar-success';
        } else {
             const classesNeeded = (goal >= 1) ? (total - attended) : Math.ceil(((goal * total) - attended) / (1 - goal));
             bunkerInfo = `<span class="bunker-info bunks-needed">Need ${classesNeeded} class${classesNeeded !== 1 ? 'es' : ''} for ${goalPercent}%.</span>`;
             if (percentNum < 50) barColorClass = 'bar-danger'; else barColorClass = 'bar-warning';
        }

        listHTML += `<li style="border-left-color: ${subjectMeta.color};">
            <div class="subject-info"><strong><span class="subject-icon">${subjectMeta.icon || ''}</span> ${name}</strong><span class="percentage-text">${percent}%</span></div>
            <div class="progress-bar-container"><div class="progress-bar ${barColorClass}" style="width: ${percent}%; background-color: ${subjectMeta.color};"></div></div>
            ${bunkerInfo}
        </li>`;
        chartLabels.push(`${subjectMeta.icon || ''} ${name}`);
        chartData.push(percentNum);
        chartColors.push(subjectMeta.color);
    });
    listHTML += '</ul>';
    listDiv.innerHTML = listHTML;
    drawAttendanceChart(chartLabels, chartData, chartColors, subjectTotals, overallAverage);
}

function calculateSubjectTotals() {
    let totals = {};
    const processEntry = (entry) => {
        entry?.subjects?.forEach(s => {
             if (s && s.name && subjectsMaster[s.name]) {
                 if (!totals[s.name]) totals[s.name] = {attended: 0, total: 0};
                 totals[s.name].total += 1;
                 if (s.attended) totals[s.name].attended += 1;
             }
        });
    };
    monthlyHistory.forEach(month => month.attendance?.forEach(processEntry));
    attendance.forEach(processEntry);
    return totals;
}

function drawAttendanceChart(labels, data, colors, subjectTotals, overallAverage) {
    const canvas = document.getElementById('attendanceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (attendanceChart) { attendanceChart.destroy(); }

    const style = getComputedStyle(document.body);
    const gridColor = style.getPropertyValue('--chart-grid-color').trim() || 'rgba(0,0,0,0.1)';
    const labelColor = style.getPropertyValue('--text-light').trim() || '#666';
    const titleColor = style.getPropertyValue('--text-dark').trim() || '#222';
    const dangerColor = style.getPropertyValue('--danger-color').trim() || '#ff3b30';
    const getLuminance = (hex) => { /* ... keep luminance function ... */ }; // Keep luminance calc

    attendanceChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [ /* ... datasets from previous version ... */ ] },
        options: { /* ... options from previous version ... */ }
    });
}

// --- Projections ---
function showProjectionsCard() {
    const projectionSection = document.getElementById('projections');
    if (projectionSection) projectionSection.style.display = 'block';
    populateProjectionSubjects();
}
function populateProjectionSubjects() {
    const select = document.getElementById('projection-subject');
    const attendBtn = document.getElementById('project-attend-btn');
    const missBtn = document.getElementById('project-miss-btn');
    if (!select || !attendBtn || !missBtn) return;

    select.innerHTML = '';
    const subjectNames = Object.keys(calculateSubjectTotals()).sort();

    if (subjectNames.length === 0) {
        select.innerHTML = '<option value="">No subjects available</option>';
        attendBtn.disabled = true; missBtn.disabled = true;
    } else {
        subjectNames.forEach(name => { select.add(new Option(name, name)); });
        attendBtn.disabled = false; missBtn.disabled = false;
    }
}
function calculateProjection(attendFuture) {
     const subjectName = document.getElementById('projection-subject')?.value;
     const futureClassesInput = document.getElementById('projection-classes');
     const resultDiv = document.getElementById('projection-result');
     if (!subjectName || !futureClassesInput || !resultDiv) return;

     let futureClasses = parseInt(futureClassesInput.value) || 0;
     if (futureClasses < 1) { futureClasses = 1; futureClassesInput.value = 1; }

     const subjectTotals = calculateSubjectTotals();
     const currentData = subjectTotals[subjectName] || { attended: 0, total: 0 };
     const futureAttended = attendFuture ? futureClasses : 0;
     const newAttended = currentData.attended + futureAttended;
     const newTotal = currentData.total + futureClasses;
     const newPercent = newTotal > 0 ? (newAttended / newTotal) * 100 : 0;

     resultDiv.innerHTML = `If you <strong>${attendFuture ? 'attend' : 'miss'}</strong> the next ${futureClasses} class${futureClasses !== 1 ? 'es' : ''} of <strong>${subjectName}</strong>, your new % will be <strong>${newPercent.toFixed(2)}%</strong> (${newAttended}/${newTotal}).`;
     resultDiv.className = attendFuture ? 'projection-result success' : 'projection-result error';
     resultDiv.classList.remove('hidden');
}


// --- Utility & Event Handlers ---

// Custom Notification (Keep as is)
let notificationConfirmCallback = null;
function showNotification(message, type = 'info', callback = null, title = '') {
     const overlay = document.getElementById('custom-notification-overlay');
     const box = document.getElementById('custom-notification-box'); // Needed for transition
     const titleEl = document.getElementById('custom-notification-title');
     const messageEl = document.getElementById('custom-notification-message');
     const iconEl = overlay?.querySelector('.notification-icon');
     const okBtn = document.getElementById('custom-notification-ok');
     const confirmBtn = document.getElementById('custom-notification-confirm');
     const cancelBtn = document.getElementById('custom-notification-cancel');
     // Safety checks
     if (!overlay || !box || !titleEl || !messageEl || !iconEl || !okBtn || !confirmBtn || !cancelBtn) {
         console.error("Notification elements not found!");
         alert(message); // Fallback to basic alert
         return;
     }

     messageEl.textContent = message;
     notificationConfirmCallback = callback; // Store the callback

     // Reset buttons and icon
     iconEl.className = 'notification-icon'; // Reset class list
     okBtn.style.display = 'none';
     confirmBtn.style.display = 'none';
     cancelBtn.style.display = 'none';

     switch (type) {
         case 'confirm':
             titleEl.textContent = title || 'Confirm Action';
             iconEl.innerHTML = '❓'; iconEl.classList.add('notification-icon-confirm');
             confirmBtn.style.display = 'inline-block';
             cancelBtn.style.display = 'inline-block';
             break;
         case 'success':
             titleEl.textContent = title || 'Success';
             iconEl.innerHTML = '✅'; iconEl.classList.add('notification-icon-success');
             okBtn.style.display = 'inline-block';
             break;
         case 'error':
             titleEl.textContent = title || 'Error';
             iconEl.innerHTML = '❌'; iconEl.classList.add('notification-icon-error');
             okBtn.style.display = 'inline-block';
             break;
         case 'info':
         default:
             titleEl.textContent = title || 'Information';
             iconEl.innerHTML = 'ℹ️'; iconEl.classList.add('notification-icon-info');
             okBtn.style.display = 'inline-block';
             break;
     }
     overlay.classList.remove('hidden', 'is-hiding');
     // Force reflow before adding class to trigger animation (if needed, though opacity handles it)
     // void box.offsetWidth;
     // box.classList.add('visible'); // If using transform animation
 }
 function hideNotification() {
     const overlay = document.getElementById('custom-notification-overlay');
     const box = document.getElementById('custom-notification-box');
     if (!overlay || !box) return;

     overlay.classList.add('is-hiding'); // Start fade out
     // box.classList.remove('visible'); // If using transform animation

     // Use transitionend event listener for smoother hiding
     const onTransitionEnd = () => {
         overlay.classList.add('hidden');
         overlay.classList.remove('is-hiding');
         notificationConfirmCallback = null; // Clear callback only after hidden
         overlay.removeEventListener('transitionend', onTransitionEnd); // Clean up listener
     };
     overlay.addEventListener('transitionend', onTransitionEnd);

     // Fallback timeout in case transitionend doesn't fire (e.g., if display:none is used)
     setTimeout(() => {
         if (!overlay.classList.contains('hidden')) {
             overlay.classList.add('hidden');
             overlay.classList.remove('is-hiding');
             notificationConfirmCallback = null;
             overlay.removeEventListener('transitionend', onTransitionEnd); // Clean up listener
         }
     }, 350); // Slightly longer than CSS transition
 }
 function setupNotificationListeners() {
     document.getElementById('custom-notification-ok')?.addEventListener('click', hideNotification);
     document.getElementById('custom-notification-cancel')?.addEventListener('click', hideNotification);
     document.getElementById('custom-notification-confirm')?.addEventListener('click', () => {
         if (typeof notificationConfirmCallback === 'function') {
             try {
                 notificationConfirmCallback(); // Execute the stored callback
             } catch (e) {
                 console.error("Error executing notification callback:", e);
             }
         }
         hideNotification(); // Hide after executing
     });
     // Optional: Close on overlay click
     document.getElementById('custom-notification-overlay')?.addEventListener('click', (e) => {
         if (e.target === e.currentTarget) { // Only if clicking overlay itself
             // Only hide if it's not a confirm dialog (prevent accidental cancel)
             const confirmBtn = document.getElementById('custom-notification-confirm');
             if (!confirmBtn || confirmBtn.style.display === 'none') {
                 hideNotification();
             }
         }
     });
 }


function removeAllRecords() { showNotification( 'Delete all records? Cannot be undone.', 'confirm', () => { localStorage.clear(); timetable = {}; attendance = []; monthlyHistory = []; currentMonthName = null; subjectsMaster = {}; location.reload(); }); }
function deleteDayAttendance() { /* ... keep as is ... */ }
function toggleModifyForm(show = false, mode = 'add') { /* ... keep as is ... */ }
function handleModifySubject(e) { /* ... keep as is, uses subjectName now */ }
function checkNewDate(e) { /* ... keep as is ... */ }
function exportData() { /* ... keep as is ... */ }
function importData() { /* ... keep as is ... */ }


// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
    try {
        loadFromLocal();
        createTimetableInputs();

        // Attach all event listeners using dedicated function
        attachEventListeners();

        // Initial UI State Logic
        setupInitialUIState();

    } catch (e) {
        console.error("Critical error during initialization:", e);
        document.body.innerHTML = `<div style="padding: 20px; text-align: center; color: red;"><h1>Application Error</h1><p>A critical error occurred. Data might be corrupted.</p><p>Try clearing application data or resetting.</p><pre style="margin-top: 20px; text-align: left; background: #eee; padding: 10px; border-radius: 5px;">${e.stack || e.message}</pre></div>`;
    }
});

// Helper function to attach all event listeners
function attachEventListeners() {
    // Core Forms
    document.getElementById('timetable-form')?.addEventListener('submit', saveTimetable);
    document.getElementById('attendance-form')?.addEventListener('submit', submitAttendance);
    document.getElementById('previous-attendance-form')?.addEventListener('submit', savePreviousAttendance);
    document.getElementById('modify-subject-form')?.addEventListener('submit', handleModifySubject);

    // Buttons
    document.getElementById('remove-all')?.addEventListener('click', removeAllRecords);
    document.getElementById('skip-previous-btn')?.addEventListener('click', skipPreviousAttendance);
    document.getElementById('export-data-btn')?.addEventListener('click', exportData);
    document.getElementById('delete-day-btn')?.addEventListener('click', deleteDayAttendance);
    document.getElementById('add-subject-btn-show')?.addEventListener('click', () => toggleModifyForm(true, 'add'));
    document.getElementById('remove-subject-btn-show')?.addEventListener('click', () => toggleModifyForm(true, 'remove'));
    document.getElementById('cancel-modify')?.addEventListener('click', () => toggleModifyForm(false));
    document.getElementById('project-attend-btn')?.addEventListener('click', () => calculateProjection(true));
    document.getElementById('project-miss-btn')?.addEventListener('click', () => calculateProjection(false));

    // Import Button Logic (Handles file input click)
    const importBtn = document.getElementById('import-data-btn');
    const fileInput = document.getElementById('import-file-input');
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', importData);
    }

    // Input changes
    document.getElementById('attendance-goal-input')?.addEventListener('change', handleGoalChange);
    document.getElementById('modify-date')?.addEventListener('change', checkNewDate);
    document.getElementById('projection-subject')?.addEventListener('change', () => document.getElementById('projection-result')?.classList.add('hidden'));
    document.getElementById('projection-classes')?.addEventListener('input', () => document.getElementById('projection-result')?.classList.add('hidden'));

    // Theme and Accent Listeners
    setupThemeListeners();
    setupAccentColorListeners();

    // Custom Notification Listeners
    setupNotificationListeners();
}

// Separate listener setup for theme
function setupThemeListeners() {
    const themeButtons = document.querySelectorAll('.theme-button');
    if (!themeButtons.length) return;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    function setTheme(theme) {
        const validThemes = ['light', 'dark', 'zen']; theme = validThemes.includes(theme) ? theme : 'light';
        document.body.dataset.theme = theme; localStorage.setItem('theme', theme);
        themeButtons.forEach(button => { button.classList.toggle('active', button.dataset.theme === theme); });
        if (document.getElementById('results')?.style.display === 'block') { showCompleteAttendance(); } // Redraw chart
    }
    const savedTheme = localStorage.getItem('theme');
    setTheme(savedTheme || (systemPrefersDark ? 'dark' : 'light')); // Initial set
    themeButtons.forEach(button => { button.addEventListener('click', () => setTheme(button.dataset.theme)); });
}

// Separate listener setup for accent color
function setupAccentColorListeners() {
    const colorSwatchContainer = document.getElementById('color-swatch-container');
    const swatches = colorSwatchContainer?.querySelectorAll('.color-swatch');
    if (!colorSwatchContainer || !swatches || !swatches.length) return;

    function setAccentColor(color) {
        if (!color) { color = '#007aff'; } // Default
        try {
            document.documentElement.style.setProperty('--primary-accent', color);
            const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
            if (match) {
                 const r = parseInt(match[1], 16), g = parseInt(match[2], 16), b = parseInt(match[3], 16);
                 document.documentElement.style.setProperty('--primary-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
            } else { document.documentElement.style.setProperty('--primary-glow', 'rgba(0, 122, 255, 0.3)'); }
        } catch (e) {
             console.error("Error applying accent color:", e);
             try { document.documentElement.style.setProperty('--primary-accent', '#007aff'); document.documentElement.style.setProperty('--primary-glow', 'rgba(0, 122, 255, 0.3)'); } catch {}
             localStorage.setItem('accent_color', '#007aff'); color = '#007aff';
        }
        localStorage.setItem('accent_color', color);
        swatches.forEach(swatch => { swatch.classList.toggle('active', swatch.dataset.color === color); });
        updateUIColors();
    }
    colorSwatchContainer.addEventListener('click', (e) => { if (e.target.classList.contains('color-swatch')) { setAccentColor(e.target.dataset.color); } });
    const savedAccent = localStorage.getItem('accent_color');
    setAccentColor(savedAccent || '#007aff'); // Initial set
    swatches.forEach(swatch => { swatch.classList.toggle('active', swatch.dataset.color === (savedAccent || '#007aff')); });
}

// Handler for goal input change
function handleGoalChange(e) {
    let goalVal = parseInt(e.target.value);
    if (isNaN(goalVal) || goalVal < 1) goalVal = 1; if (goalVal > 100) goalVal = 100;
    e.target.value = goalVal; // Correct the input value if needed
    localStorage.setItem('attendance_goal', goalVal.toString());
    showResults();
}

// Initial UI State Logic
function setupInitialUIState() {
     const timetableSetup = document.getElementById('timetable-setup');
     const projectionsSection = document.getElementById('projections');
     if (!timetableSetup || !projectionsSection) return;

     // Check if timetable has *any* weeks defined with actual subjects
     const isTimetableSetup = Object.keys(timetable).some(week =>
        timetable[week] && Object.keys(timetable[week]).length > 0 && Object.values(timetable[week]).some(dayArray => Array.isArray(dayArray) && dayArray.length > 0)
     );

     if (isTimetableSetup) {
         timetableSetup.style.display = 'none';
         const hasPreviousDataEntry = monthlyHistory.some(m => m.monthName === "Previous Data");
         if (!hasPreviousDataEntry) { createPreviousAttendanceInputs(); }
         else {
             showMonthControls(); // This function handles showing attendance mark section
             if (currentMonthName) {
                 showAttendanceForm(); showResults(); showProjectionsCard();
             } else {
                 showResults(); // Show baseline %
                 if (Object.keys(subjectsMaster).length > 0) { showProjectionsCard(); } else { projectionsSection.style.display = 'none'; }
             }
         }
     } else {
         // Timetable not set up yet
         timetableSetup.style.display = 'block';
         // Optionally reset master list if timetable is truly empty after load/migration
         // subjectsMaster = {}; saveToLocal(); createTimetableInputs();
         projectionsSection.style.display = 'none';
     }
}