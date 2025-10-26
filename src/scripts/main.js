const WEEKS = 4;
// Note: JS Date.getDay() is 0-indexed (Sun=0, Mon=1), but our array is Mon=0.
// This new array matches the Date.getDay() index for easier lookups.
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Original DAYS array (Monday-first) for logic that uses it
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];


let timetable = {};
let attendance = [];
let monthlyHistory = [];
let currentMonthName = null;

function saveToLocal() {
    localStorage.setItem('attendance_timetable', JSON.stringify(timetable));
    localStorage.setItem('attendance_data', JSON.stringify(attendance));
    localStorage.setItem('attendance_monthly_history', JSON.stringify(monthlyHistory));
    localStorage.setItem('attendance_current_month', currentMonthName || '');
}

function loadFromLocal() {
    timetable = JSON.parse(localStorage.getItem('attendance_timetable')) || {};
    attendance = JSON.parse(localStorage.getItem('attendance_data')) || [];
    monthlyHistory = JSON.parse(localStorage.getItem('attendance_monthly_history')) || [];
    currentMonthName = localStorage.getItem('attendance_current_month') || null;

    // --- MIGRATION (Keep this just in case) ---
    // Cleans up old formats if they exist
    Object.keys(timetable).forEach(day => {
        if (timetable[day] && timetable[day].length > 0 && typeof timetable[day][0] === 'object') {
            timetable[day] = timetable[day].map(subjectObj => subjectObj.name);
        }
    });
    attendance.forEach(entry => {
        if (entry.subjects && entry.subjects.length > 0 && entry.subjects[0].id) {
            entry.subjects = entry.subjects.map(subj => ({ name: subj.name, attended: subj.attended }));
        }
    });
    monthlyHistory.forEach(month => {
        if(month.attendance) {
            month.attendance.forEach(entry => {
                if (entry.subjects && entry.subjects.length > 0 && entry.subjects[0].id) {
                    entry.subjects = entry.subjects.map(subj => ({ name: subj.name, attended: subj.attended }));
                }
            });
        }
    });
    // --- END MIGRATION ---
}


function createTimetableInputs() {
    const container = document.getElementById('days-container');
    container.innerHTML = '';
    DAYS.forEach(day => {
        const label = document.createElement('label');
        label.setAttribute('for', day);
        label.textContent = `${day}: `;

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `Subjects for ${day} (comma separated)`;
        input.id = `${day}`;

        container.appendChild(label);
        container.appendChild(input);
    });
}

function saveTimetable(e) {
    e.preventDefault();
    timetable = {};
    DAYS.forEach(day => {
        const val = document.getElementById(`${day}`).value.trim();
        // Saves a simple array of strings, e.g., ["Physics", "Math"]
        timetable[day] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
    });
    saveToLocal();
    document.getElementById('timetable-setup').style.display = 'none';

    // Call the function to show the "Previous Attendance" input form
    createPreviousAttendanceInputs();
}

// --- Previous Attendance Feature ---

function getUniqueSubjects() {
    const allSubjects = Object.values(timetable).flat();
    return [...new Set(allSubjects)];
}

function createPreviousAttendanceInputs() {
    const container = document.getElementById('previous-subjects-container');
    container.innerHTML = ''; // Clear previous
    const subjects = getUniqueSubjects();

    if (subjects.length === 0) {
        showMonthControls(); // Skip if no subjects
        return;
    }

    // Your provided data for placeholders
    const exampleData = {
        "Physics": { attended: 0, total: 0 },
        "Maths": { attended: 0, total: 0 },
        "BEE": { attended: 0, total: 0 },
        "Physics Lab": { attended: 0, total: 0 },
        "BEE Lab": { attended: 0, total: 0 },
        "Workshop": { attended: 0, total: 0 },
        "FCS": { attended: 0, total: 0 },
        "FCS Lab": { attended: 0, total: 0 },
        "English": { attended: 0, total: 0 }
    };

    subjects.forEach(subject => {
        const div = document.createElement('div');
        div.className = 'previous-subject-entry';
        const placeholder = exampleData[subject] || { attended: 0, total: 0 };

        div.innerHTML = `
            <h3>${subject}</h3>
            <div class="input-group">
                <div>
                    <label for="prev-attended-${subject}">Classes Attended</label>
                    <input type="number" id="prev-attended-${subject}" min="0" value="${placeholder.attended}" placeholder="e.g. 11">
                </div>
                <div>
                    <label for="prev-total-${subject}">Total Classes Held</label>
                    <input type="number" id="prev-total-${subject}" min="0" value="${placeholder.total}" placeholder="e.g. 14">
                </div>
            </div>
        `;
        container.appendChild(div);
    });

    document.getElementById('previous-attendance-setup').style.display = 'block';
}

function savePreviousAttendance(e) {
    e.preventDefault();
    const subjects = getUniqueSubjects();
    let previousSubjects = [];
    let hasErrors = false;

    for (const subject of subjects) {
        const attendedInput = document.getElementById(`prev-attended-${subject}`);
        const totalInput = document.getElementById(`prev-total-${subject}`);

        const attended = parseInt(attendedInput.value) || 0;
        const total = parseInt(totalInput.value) || 0;

        if (attended < 0 || total < 0) {
             showNotification(`For ${subject}, attended and total classes cannot be negative.`, 'error', null, 'Input Error');
             (attended < 0 ? attendedInput : totalInput).focus();
             hasErrors = true;
             break;
        }
        if (attended > total) {
            showNotification(`For ${subject}, attended classes (${attended}) cannot be greater than total classes (${total}).`, 'error', null, 'Input Error');
            attendedInput.focus();
            hasErrors = true;
            break; // Stop processing
        }

        const missed = total - attended;

        // Add attended records
        for (let i = 0; i < attended; i++) {
            previousSubjects.push({ name: subject, attended: true });
        }
        // Add missed records
        for (let i = 0; i < missed; i++) {
            previousSubjects.push({ name: subject, attended: false });
        }
    }

    if (hasErrors) return; // Don't save if there was an error

    // Remove any existing "Previous Data" entry first
    monthlyHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data");

    if (previousSubjects.length > 0) {
        const previousEntry = {
            week: 0, day: 'N/A', date: 'N/A', month: 'Previous Data',
            subjects: previousSubjects
        };
        const monthEntry = { monthName: "Previous Data", attendance: [previousEntry] };
        monthlyHistory.push(monthEntry);
    }
    // Even if counts are zero, save that we completed this step
    else if (!monthlyHistory.some(m => m.monthName === "Previous Data")) {
         const monthEntry = { monthName: "Previous Data", attendance: [] }; // Add empty entry
         monthlyHistory.push(monthEntry);
    }

    saveToLocal(); // Save the updated history

    document.getElementById('previous-attendance-setup').style.display = 'none';
    showMonthControls();
    showNotification('Previous attendance data saved successfully.', 'success');
    showResults(); // Recalculate results immediately
}

function skipPreviousAttendance() {
     // Add an empty "Previous Data" entry so the app knows this step was skipped
     if (!monthlyHistory.some(m => m.monthName === "Previous Data")) {
         const monthEntry = { monthName: "Previous Data", attendance: [] };
         monthlyHistory.push(monthEntry);
         saveToLocal();
     }
    document.getElementById('previous-attendance-setup').style.display = 'none';
    showMonthControls();
}

// --- End Previous Attendance Feature ---

function showMonthControls() {
    const controls = document.getElementById('month-controls');
    const newMonthBtn = document.getElementById('new-month-btn');
    const newMonthForm = document.getElementById('new-month-form');
    const monthNameInput = document.getElementById('month-name-input');

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
        if (currentMonthName && attendance.length) {
            monthlyHistory.push({
                monthName: currentMonthName,
                attendance: JSON.parse(JSON.stringify(attendance))
            });
        }
        currentMonthName = name;
        attendance = [];
        saveToLocal();
        updateMonthLabel();
        newMonthForm.style.display = 'none';
        document.getElementById('attendance-mark').style.display = 'block';
        showAttendanceForm();
        showResults();
    };
}

function updateMonthLabel() {
    const label = document.getElementById('current-month-label');
    label.textContent = currentMonthName ? `Current Month: ${currentMonthName}` : 'No month started';
    document.getElementById('attendance-mark').style.display = currentMonthName ? 'block' : 'none';
}

function showAttendanceForm() {
    const selectorsDiv = document.getElementById('week-day-selectors'); selectorsDiv.innerHTML = ''; const weekLabel = document.createElement('label'); weekLabel.setAttribute('for', 'attendance-week-select'); weekLabel.textContent = 'Select Week:'; const weekSelect = document.createElement('select'); weekSelect.id = 'attendance-week-select'; for (let w = 1; w <= WEEKS; w++) { const opt = document.createElement('option'); opt.value = w; opt.textContent = `Week ${w}`; weekSelect.appendChild(opt); }
    const dayLabel = document.createElement('label'); dayLabel.setAttribute('for', 'attendance-day-select'); dayLabel.textContent = 'Select Day:'; const daySelect = document.createElement('select'); daySelect.id = 'attendance-day-select'; DAYS.forEach(day => { const opt = document.createElement('option'); opt.value = day; opt.textContent = day; daySelect.appendChild(opt); });
    const dateLabel = document.createElement('label'); dateLabel.setAttribute('for', 'attendance-date'); dateLabel.textContent = 'Or Select Date:'; const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.id = 'attendance-date';
    const weekWrapper = document.createElement('div'); weekWrapper.appendChild(weekLabel); weekWrapper.appendChild(weekSelect); const dayWrapper = document.createElement('div'); dayWrapper.appendChild(dayLabel); dayWrapper.appendChild(daySelect); const dateWrapper = document.createElement('div'); dateWrapper.appendChild(dateLabel); dateWrapper.appendChild(dateInput);
    selectorsDiv.appendChild(weekWrapper); selectorsDiv.appendChild(dayWrapper); selectorsDiv.appendChild(dateWrapper);

    function renderSubjects() {
        const todayDiv = document.getElementById('today-classes'); todayDiv.innerHTML = ''; const day = daySelect.value; todayDiv.innerHTML += `<h3>${day}</h3>`; const subjects = timetable[day] || []; const uniqueSubjects = [...new Set(subjects)];
        if (!uniqueSubjects.length) { todayDiv.innerHTML += '<p>No classes scheduled.</p>'; } else { uniqueSubjects.forEach(subjectName => { const label = document.createElement('label'); label.innerHTML = `<input type="checkbox" name="subject" value="${subjectName}"> <span>${subjectName}</span>`; todayDiv.appendChild(label); }); }
    }
    weekSelect.addEventListener('change', renderSubjects); daySelect.addEventListener('change', renderSubjects); dateInput.addEventListener('change', (e) => { const date = e.target.value; if (!date) return; const dateParts = date.split('-'); const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]); const dayName = DAYS_OF_WEEK[localDate.getDay()]; const dayOfMonth = localDate.getDate(); const calculatedWeek = Math.min(Math.ceil(dayOfMonth / 7), WEEKS); weekSelect.value = calculatedWeek; daySelect.value = dayName; renderSubjects(); });
    renderSubjects();
}

function submitAttendance(e) {
    e.preventDefault(); if (!currentMonthName) { showNotification('Please start a new month first.', 'info'); return; } const week = parseInt(document.getElementById('attendance-week-select').value); const day = document.getElementById('attendance-day-select').value; const date = document.getElementById('attendance-date').value; const subjectsFromTimetable = timetable[day] || []; const attendedNames = Array.from(document.querySelectorAll('input[name="subject"]:checked')).map(cb => cb.value);
    const existingEntryIndex = attendance.findIndex(entry => entry.week === week && entry.day === day);
    const newSubjectsData = subjectsFromTimetable.map(name => ({ name, attended: attendedNames.includes(name) }));
    if (existingEntryIndex > -1) { attendance[existingEntryIndex].subjects = newSubjectsData; if(date) attendance[existingEntryIndex].date = date; } else { attendance.push({ week, day, date, month: currentMonthName, subjects: newSubjectsData }); }
    saveToLocal(); showResults();
}


function showResults() {
    document.getElementById('results').style.display = 'block';
    showAttendanceTable();
    showAllMonthsAttendance();
    showCompleteAttendance();
}

function showAttendanceTable() {
    const container = document.getElementById('attendance-table-container'); container.innerHTML = '<h3>Current Month Attendance</h3>'; let table = `<table class="attendance-table"><thead><tr><th>Week</th><th>Date</th><th>Day</th><th>Subjects</th></tr></thead><tbody>`; const sorted = [...attendance].sort((a, b) => { if (a.week !== b.week) return a.week - b.week; return DAYS.indexOf(a.day) - DAYS.indexOf(b.day); });
    sorted.forEach(entry => { table += `<tr><td>${entry.week}</td><td>${entry.date || ''}</td><td>${entry.day}</td><td>${entry.subjects.map(s => { const cellClass = s.attended ? 'subject-cell-attended' : 'subject-cell-missed'; const icon = s.attended ? '✅' : '❌'; return `<span class="subject-cell ${cellClass}">${s.name} ${icon}</span>`; }).join('')}</td></tr>`; }); table += '</tbody></table>'; container.innerHTML += table;
}

function showAllMonthsAttendance() {
    const container = document.getElementById('all-months-attendance'); container.innerHTML = '<h3>Previous Months</h3>'; const visibleHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data"); // Exclude baseline
    if (!visibleHistory.length) { container.innerHTML += '<p>No previous months stored.</p>'; return; }
    visibleHistory.forEach(monthEntry => { container.innerHTML += `<h4>${monthEntry.monthName}</h4>`; let subjectTotals = {}; monthEntry.attendance.forEach(entry => { entry.subjects.forEach(s => { if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0}; subjectTotals[s.name].total += 1; if (s.attended) subjectTotals[s.name].attended += 1; }); }); container.innerHTML += '<ul>'; Object.keys(subjectTotals).forEach(subject => { const {attended, total} = subjectTotals[subject]; const percent = total ? ((attended / total)* 100).toFixed(2) : 'N/A'; container.innerHTML += `<li>${subject}: ${attended}/${total} (${percent}%)</li>`; }); container.innerHTML += '</ul>'; });
}

function showCompleteAttendance() {
    const container = document.getElementById('complete-attendance'); const listDiv = document.getElementById('complete-attendance-list'); container.style.display = 'block'; listDiv.innerHTML = ''; let subjectTotals = {};
    if (Array.isArray(monthlyHistory)) { monthlyHistory.forEach(monthEntry => { if(monthEntry.attendance) { monthEntry.attendance.forEach(entry => { entry.subjects.forEach(s => { if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0}; subjectTotals[s.name].total += 1; if (s.attended) subjectTotals[s.name].attended += 1; }); }); } }); }
    if (Array.isArray(attendance)) { attendance.forEach(entry => { entry.subjects.forEach(s => { if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0}; subjectTotals[s.name].total += 1; if (s.attended) subjectTotals[s.name].attended += 1; }); }); }
    if (Object.keys(subjectTotals).length === 0) { listDiv.innerHTML = '<p>No attendance data available.</p>'; return; }
    let listHTML = '<ul>'; Object.keys(subjectTotals).sort().forEach(subject => { const {attended, total} = subjectTotals[subject]; const percent = total ? ((attended / total) * 100).toFixed(2) : 'N/A'; listHTML += `<li><strong>${subject}</strong> <span>${percent}%</span></li>`; }); listHTML += '</ul>'; listDiv.innerHTML = listHTML;
}


// --- START: Restored Functions ---
// --- Custom Notification Logic ---
let notificationConfirmCallback = null;
function showNotification(message, type = 'info', callback = null, title = '') {
    const overlay = document.getElementById('custom-notification-overlay');
    const titleEl = document.getElementById('custom-notification-title');
    const messageEl = document.getElementById('custom-notification-message');
    const iconEl = document.querySelector('.notification-icon');
    const okBtn = document.getElementById('custom-notification-ok');
    const confirmBtn = document.getElementById('custom-notification-confirm');
    const cancelBtn = document.getElementById('custom-notification-cancel');
    messageEl.textContent = message;
    notificationConfirmCallback = callback;
    iconEl.className = 'notification-icon';
    okBtn.style.display = 'none';
    confirmBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    switch (type) {
        case 'confirm':
            titleEl.textContent = title || 'Are you sure?'; iconEl.innerHTML = '❓'; iconEl.classList.add('notification-icon-confirm'); confirmBtn.style.display = 'inline-block'; cancelBtn.style.display = 'inline-block'; break;
        case 'success':
            titleEl.textContent = title || 'Success'; iconEl.innerHTML = '✅'; iconEl.classList.add('notification-icon-success'); okBtn.style.display = 'inline-block'; break;
        case 'error':
            titleEl.textContent = title || 'Error'; iconEl.innerHTML = '❌'; iconEl.classList.add('notification-icon-error'); okBtn.style.display = 'inline-block'; break;
        case 'info': default:
            titleEl.textContent = title || 'Notification'; iconEl.innerHTML = 'ℹ️'; iconEl.classList.add('notification-icon-info'); okBtn.style.display = 'inline-block'; break;
    }
    overlay.classList.remove('hidden', 'is-hiding');
}
function hideNotification() {
    const overlay = document.getElementById('custom-notification-overlay');
    overlay.classList.add('is-hiding');
    setTimeout(() => { overlay.classList.add('hidden'); overlay.classList.remove('is-hiding'); notificationConfirmCallback = null; }, 300);
}
function setupNotificationListeners() {
    document.getElementById('custom-notification-ok').addEventListener('click', hideNotification);
    document.getElementById('custom-notification-cancel').addEventListener('click', hideNotification);
    document.getElementById('custom-notification-confirm').addEventListener('click', () => { if (typeof notificationConfirmCallback === 'function') { notificationConfirmCallback(); } hideNotification(); });
}
// --- End Custom Notification Logic ---

// --- Remove All Records ---
function removeAllRecords() {
    showNotification( 'Are you sure you want to remove all records? This action cannot be undone.', 'confirm', () => { localStorage.clear(); timetable = {}; attendance = []; monthlyHistory = []; currentMonthName = null; location.reload(); });
}

// --- Delete Day's Attendance ---
function deleteDayAttendance() {
    const week = parseInt(document.getElementById('attendance-week-select').value); const day = document.getElementById('attendance-day-select').value; const entryExists = attendance.some(entry => entry.week === week && entry.day === day); if (!entryExists) { showNotification(`No attendance has been recorded for ${day}, Week ${week}.`, 'error', null, 'Nothing to Delete'); return; } showNotification( `Are you sure you want to delete all attendance for ${day}, Week ${week}?`, 'confirm', () => { attendance = attendance.filter(entry => !(entry.week === week && entry.day === day)); saveToLocal(); showResults(); showNotification(`Attendance deleted for ${day}, Week ${week}.`, 'success'); });
}

// --- Add/Remove Subject Logic ---
function toggleModifyForm(show = false, mode = 'add') {
    const form = document.getElementById('modify-subject-form'); const buttons = document.getElementById('modify-buttons-container'); const title = document.getElementById('modify-form-title'); const action = document.getElementById('modify-action'); const newDateFields = document.getElementById('new-date-fields'); const attendedWrapper = document.getElementById('modify-attended-wrapper');
    if (show) { title.textContent = mode === 'add' ? 'Add Subject' : 'Remove Subject'; action.value = mode; form.classList.remove('hidden'); buttons.classList.add('hidden'); document.getElementById('modify-date').value = ''; document.getElementById('modify-subject').value = ''; document.getElementById('modify-attended').checked = false; newDateFields.classList.add('hidden'); if (mode === 'add') { attendedWrapper.classList.remove('hidden'); } else { attendedWrapper.classList.add('hidden'); } } else { form.classList.add('hidden'); buttons.classList.remove('hidden'); attendedWrapper.classList.add('hidden'); }
}
function handleModifySubject(e) {
    e.preventDefault(); const action = document.getElementById('modify-action').value; const date = document.getElementById('modify-date').value; const subject = document.getElementById('modify-subject').value; if (!date || !subject) { showNotification('Please fill in both date and subject name.', 'error', null, 'Missing Information'); return; } let entry = attendance.find(e => e.date === date);
    if (action === 'add') { const attended = document.getElementById('modify-attended').checked; if (!entry) { const week = parseInt(document.getElementById('modify-week').value); const day = document.getElementById('modify-day').value; if (!week || !day) { showNotification('Error: Week and Day are required for a new date.', 'error'); return; } entry = { week, day, date, month: currentMonthName, subjects: [] }; attendance.push(entry); } entry.subjects.push({ name: subject, attended: attended }); showNotification(`Subject "${subject}" added for ${date} (Attended: ${attended ? 'Yes' : 'No'}).`, 'success'); } else if (action === 'remove') { if (!entry) { showNotification('No attendance entry found for this date.', 'error'); return; } const idx = entry.subjects.findIndex(s => s.name === subject); if (idx !== -1) { entry.subjects.splice(idx, 1); showNotification(`Subject "${subject}" removed for ${date}.`, 'success'); } else { showNotification('Subject not found for this date.', 'error'); } } saveToLocal(); showResults(); toggleModifyForm(false);
}
function checkNewDate(e) {
    const date = e.target.value; if (!date) return; const entry = attendance.find(e => e.date === date); const newDateFields = document.getElementById('new-date-fields'); if (document.getElementById('modify-action').value === 'add' && !entry) { newDateFields.classList.remove('hidden'); const dateParts = date.split('-'); const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]); const dayName = DAYS_OF_WEEK[localDate.getDay()]; document.getElementById('modify-day').value = dayName; } else { newDateFields.classList.add('hidden'); }
}
// --- End Add/Remove Subject Logic ---

// --- Import/Export Logic ---
function exportData() {
    const dataToExport = { timetable: localStorage.getItem('attendance_timetable') || '{}', attendance_data: localStorage.getItem('attendance_data') || '[]', monthly_history: localStorage.getItem('attendance_monthly_history') || '[]', current_month: localStorage.getItem('attendance_current_month') || null }; const jsonString = JSON.stringify(dataToExport, null, 2); const blob = new Blob([jsonString], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'attendance_backup.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); showNotification('Data exported successfully!', 'success');
}
function importData() {
    const fileInput = document.getElementById('import-file-input'); const file = fileInput.files[0]; if (!file) { showNotification('Please select a file to import.', 'error'); return; } const reader = new FileReader(); reader.onload = (event) => { try { const jsonString = event.target.result; const importedData = JSON.parse(jsonString); if (importedData.timetable && importedData.attendance_data && importedData.monthly_history) { showNotification( 'Are you sure you want to import this file? All current data will be overwritten.', 'confirm', () => { localStorage.setItem('attendance_timetable', importedData.timetable); localStorage.setItem('attendance_data', importedData.attendance_data); localStorage.setItem('attendance_monthly_history', importedData.monthly_history); localStorage.setItem('attendance_current_month', importedData.current_month || null); showNotification('Import successful! The page will now reload.', 'success'); setTimeout(() => { location.reload(); }, 1500); }); } else { throw new Error('Invalid file format.'); } } catch (error) { showNotification(`Import failed. The file is not a valid backup. ${error.message}`, 'error', null, 'Import Error'); } finally { fileInput.value = ''; } }; reader.onerror = () => { showNotification('Failed to read the file.', 'error', null, 'File Read Error'); fileInput.value = ''; }; reader.readAsText(file);
}
// --- End Import/Export Logic ---
// --- END: Restored Functions ---


// Add event listeners after DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
    loadFromLocal();
    createTimetableInputs();

    // Core Listeners
    document.getElementById('timetable-form').addEventListener('submit', saveTimetable);
    document.getElementById('attendance-form').addEventListener('submit', submitAttendance);
    document.getElementById('remove-all').addEventListener('click', removeAllRecords);

    // --- Previous Attendance Listeners ---
    document.getElementById('previous-attendance-form').addEventListener('submit', savePreviousAttendance);
    document.getElementById('skip-previous-btn').addEventListener('click', skipPreviousAttendance);

    // --- Settings & Other Buttons ---
    document.getElementById('export-data-btn').addEventListener('click', exportData);
    document.getElementById('import-data-btn').addEventListener('click', importData);
    document.getElementById('delete-day-btn').addEventListener('click', deleteDayAttendance);

    // Modify Form Listeners
    document.getElementById('add-subject-btn-show').addEventListener('click', () => toggleModifyForm(true, 'add'));
    document.getElementById('remove-subject-btn-show').addEventListener('click', () => toggleModifyForm(true, 'remove'));
    document.getElementById('cancel-modify').addEventListener('click', () => toggleModifyForm(false));
    document.getElementById('modify-subject-form').addEventListener('submit', handleModifySubject);
    document.getElementById('modify-date').addEventListener('change', checkNewDate);

    // Custom Notification Listener
    setupNotificationListeners();

    // --- Page Load Logic ---
    if (Object.keys(timetable).length) {
        document.getElementById('timetable-setup').style.display = 'none';
        const hasPreviousDataEntry = monthlyHistory.some(m => m.monthName === "Previous Data");

        if (!hasPreviousDataEntry) {
             createPreviousAttendanceInputs(); // Show the form to input baseline
        } else {
            showMonthControls();
            if (currentMonthName) {
                document.getElementById('attendance-mark').style.display = 'block';
                showAttendanceForm();
                showResults();
            } else {
                 showResults(); // Show baseline % even if no month started
            }
        }
    }
    // --- End Page Load Logic ---
});