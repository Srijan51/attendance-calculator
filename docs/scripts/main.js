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

// Note: JS Date.getDay() is 0-indexed (Sun=0, Mon=1), but our array is Mon=0.
// This new array matches the Date.getDay() index for easier lookups.
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Original DAYS array (Monday-first) for logic that uses it
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Default subject colors
const DEFAULT_COLORS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5856d6', '#ff2d55', '#ffcc00'];

let timetable = {}; // { day: [ {name, start, end}, ...] }
let subjectsMaster = {}; // { subjectName: { color: '#...', icon: '🧪' } }
let attendance = []; // { day, date, month, subjects: [{ name, status: 'attended'|'missed'|'cancelled' }] }
let monthlyHistory = [];
let currentMonthName = null;
let holidays = []; // { start: date, end: date, name: string }

// NEW: Profiles mapping
let profiles = {}; // { "Profile Name": { timetable, attendance, monthlyHistory, currentMonthName, holidays } }
let currentProfileId = null;

let attendanceChart = null; // Variable to hold the chart instance
let calendarView = new Date(); // State for the calendar

// --- Core Data Handling ---

function saveToLocal() {
    try {
        if (currentProfileId && profiles[currentProfileId]) {
            profiles[currentProfileId].timetable = timetable;
            profiles[currentProfileId].attendance = attendance;
            profiles[currentProfileId].monthlyHistory = monthlyHistory;
            profiles[currentProfileId].currentMonthName = currentMonthName;
            profiles[currentProfileId].holidays = holidays || [];
        }
        
        localStorage.setItem('attendance_profiles', JSON.stringify(profiles));
        localStorage.setItem('attendance_active_profile', currentProfileId || '');
        localStorage.setItem('attendance_subjects_master', JSON.stringify(subjectsMaster)); // Save master list
        
        // No longer saving directly to 'attendance_data' except for backward compatibility if needed, but not strictly necessary since migration handles it.
        // We will just let old localStorage keys lie dormant or users can export/clear them if they want later.
    } catch (e) {
        console.error("Error saving data to localStorage:", e);
        showNotification("Could not save data. Local storage might be full or disabled.", "error", null, "Save Error");
    }
}

function loadFromLocal() {
    try {
        profiles = JSON.parse(localStorage.getItem('attendance_profiles') || '{}');
        currentProfileId = localStorage.getItem('attendance_active_profile');
        subjectsMaster = JSON.parse(localStorage.getItem('attendance_subjects_master') || '{}');

        // MIGRATION OF OLD DATA
        if (Object.keys(profiles).length === 0) {
            const oldTimetable = JSON.parse(localStorage.getItem('attendance_timetable') || '{}');
            const oldAttendance = JSON.parse(localStorage.getItem('attendance_data') || '[]');
            const oldHistory = JSON.parse(localStorage.getItem('attendance_monthly_history') || '[]');
            const oldMonth = localStorage.getItem('attendance_current_month');

            if (Object.keys(oldTimetable).length > 0 || oldAttendance.length > 0 || oldHistory.length > 0) {
                profiles["Semester 1"] = {
                    timetable: oldTimetable,
                    attendance: oldAttendance,
                    monthlyHistory: oldHistory,
                    currentMonthName: oldMonth,
                    holidays: []
                };
                currentProfileId = "Semester 1";
                console.log("Migrated older flat data structure to Semester profiles.");
                // Immediately save the new structure
                saveToLocal();
            } else {
                currentProfileId = "Default Profile";
                profiles[currentProfileId] = { timetable: {}, attendance: [], monthlyHistory: [], currentMonthName: null, holidays: [] };
            }
        }

        if (!currentProfileId || !profiles[currentProfileId]) {
            currentProfileId = Object.keys(profiles)[0] || "Default Profile";
            if (!profiles[currentProfileId]) {
                 profiles[currentProfileId] = { timetable: {}, attendance: [], monthlyHistory: [], currentMonthName: null, holidays: [] };
            }
        }

        // Sync active profile to globals
        timetable = profiles[currentProfileId].timetable || {};
        attendance = profiles[currentProfileId].attendance || [];
        monthlyHistory = profiles[currentProfileId].monthlyHistory || [];
        currentMonthName = profiles[currentProfileId].currentMonthName || null;
        holidays = profiles[currentProfileId].holidays || [];

        // Load goal setting
        const goalInput = document.getElementById('attendance-goal-input');
        if (goalInput) {
            goalInput.value = localStorage.getItem('attendance_goal') || '75';
        }

        // --- MIGRATION (Handle older data formats like strings to bools) ---
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
        // Migrate timetable (if it has week keys '1', '2', etc.)
        if (timetable['1'] && typeof timetable['1'] === 'object') {
            console.log("Migrating old multi-week timetable format to single timetable...");
            const oldTimetable = JSON.parse(JSON.stringify(timetable));
            timetable = {}; // New simple format
            // Use Week 1 as the source of truth
            DAYS.forEach(day => {
                if (oldTimetable['1'][day] && Array.isArray(oldTimetable['1'][day])) {
                     const subjectNames = oldTimetable['1'][day].map(s => typeof s === 'object' ? s.name : s).filter(Boolean);
                     timetable[day] = [...subjectNames];
                     subjectNames.forEach(name => { if (name && !subjectsMaster[name]) addSubjectToMaster(name); });
                } else {
                     timetable[day] = [];
                }
            });
            needsSave = true;
        } else {
            // Ensure all days exist and check master
            DAYS.forEach(day => {
                if (!timetable[day]) timetable[day] = [];
                timetable[day].forEach(name => { if (name && !subjectsMaster[name]) addSubjectToMaster(name); })
            });
        }

        // Migrate attendance data (remove week, remove note, add status)
        const migrateEntrySubjects = (entry) => {
             let migrated = false;
             if (entry && entry.hasOwnProperty('week')) { // Check for old week property
                delete entry.week;
                migrated = true;
             }
             if (entry && entry.hasOwnProperty('note')) { // Check for old note property
                delete entry.note;
                migrated = true;
             }

             if (entry && entry.subjects && entry.subjects.length > 0) {
                 // *** NEW MIGRATION: from {attended: bool} to {status: string}
                 if (entry.subjects[0].hasOwnProperty('attended')) {
                    console.log("Migrating attendance from 'attended' to 'status' format...");
                    entry.subjects = entry.subjects.map(subj => {
                        if (subj === null || typeof subj !== 'object') return null; // Skip invalid
                        const name = subj.name;
                        if (typeof name !== 'string' || !name.trim()) return null; // Skip invalid subject data
                        const status = subj.attended ? 'attended' : 'missed'; // Convert bool to string
                        if (!subjectsMaster[name]) addSubjectToMaster(name);
                        return { name: name, status: status };
                    }).filter(Boolean); // Remove null entries
                    migrated = true;
                 } else {
                    // Ensure subjects from valid entries are in master list
                    entry.subjects.forEach(subj => { if (subj && subj.name && !subjectsMaster[subj.name]) addSubjectToMaster(subj.name); });
                 }
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
    renderHolidays();
    const container = document.getElementById(`days-container`);
    if (!container) return; 
    container.innerHTML = '';
    
    DAYS.forEach(day => {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day-card';
        dayDiv.innerHTML = `<h3>${day}</h3><div class="classes-list" id="classes-${day}"></div>
                            <button type="button" class="button-secondary add-class-btn" data-day="${day}">+ Add Class</button>`;
        container.appendChild(dayDiv);
        
        const classesList = dayDiv.querySelector(`#classes-${day}`);
        const dayClasses = timetable[day] || [];
        
        dayClasses.forEach(cls => {
             const name = typeof cls === 'object' ? cls.name : cls;
             const start = typeof cls === 'object' ? (cls.start || '') : '';
             const end = typeof cls === 'object' ? (cls.end || '') : '';
             if (name) addClassUI(classesList, name, start, end);
        });
        
        dayDiv.querySelector('.add-class-btn').addEventListener('click', () => {
             addClassUI(classesList, '', '', '');
        });
    });
}

function addClassUI(container, name, start, end) {
    const row = document.createElement('div');
    row.className = 'class-row';
    row.innerHTML = `
        <input type="text" class="class-name" placeholder="Subject Name" value="${name}" required style="flex:2;">
        <input type="time" class="class-start" value="${start}" style="display:none;">
        <input type="time" class="class-end" value="${end}" style="display:none;">
        <button type="button" class="button-danger remove-class-btn" title="Remove Subject">&times;</button>
    `;
    row.querySelector('.remove-class-btn').addEventListener('click', () => {
        row.remove();
    });
    container.appendChild(row);
}

function renderHolidays() {
    const list = document.getElementById('holidays-list');
    if (!list) return;
    list.innerHTML = '';
    
    holidays.forEach(h => {
        addHolidayUI(list, h.name, h.start, h.end);
    });
}

function addHolidayUI(container, name = '', start = '', end = '') {
    const row = document.createElement('div');
    row.className = 'class-row'; 
    row.innerHTML = `
        <input type="text" class="holiday-name" placeholder="Holiday Name (e.g. Diwali)" value="${name}" required style="flex: 2;">
        <input type="date" class="holiday-start" value="${start}" required style="flex: 1;">
        <input type="date" class="holiday-end" value="${end}" required style="flex: 1;">
        <button type="button" class="button-danger remove-class-btn" title="Remove Holiday">&times;</button>
    `;
    row.querySelector('.remove-class-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
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
         showCompleteAttendance(); showAttendanceTable(); renderCalendar();
    }
    if (document.getElementById('attendance-mark')?.style.display === 'block') {
         showAttendanceForm();
    }
}

function saveTimetable(e) {
    e.preventDefault();
    timetable = {};
    const newMasterSubjects = new Set();

    DAYS.forEach(day => {
        timetable[day] = [];
        const classesList = document.getElementById(`classes-${day}`);
        if(classesList) {
            const rows = classesList.querySelectorAll('.class-row');
            rows.forEach(row => {
                const name = row.querySelector('.class-name').value.trim();
                const start = row.querySelector('.class-start').value;
                const end = row.querySelector('.class-end').value;
                if(name) {
                    timetable[day].push({name, start, end});
                    addSubjectToMaster(name);
                    newMasterSubjects.add(name);
                }
            });
        }
    });

    holidays = [];
    const hRows = document.querySelectorAll('#holidays-list .class-row');
    hRows.forEach(row => {
        const name = row.querySelector('.holiday-name').value.trim();
        const start = row.querySelector('.holiday-start').value;
        const end = row.querySelector('.holiday-end').value;
        if (name && start && end) {
            holidays.push({name, start, end});
        }
    });

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
            DAYS.forEach(day => { if (timetable[day]) { timetable[day] = timetable[day].filter(name => name !== subjectName); } });
            attendance.forEach(entry => { entry.subjects = entry.subjects?.filter(subj => subj.name !== subjectName); });
            attendance = attendance.filter(entry => entry.subjects?.length > 0); 
            monthlyHistory.forEach(month => { month.attendance?.forEach(entry => { entry.subjects = entry.subjects?.filter(subj => subj.name !== subjectName); }); month.attendance = month.attendance?.filter(entry => entry.subjects?.length > 0); });
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
    Object.values(timetable).flat().forEach(cls => {
        const name = typeof cls === 'object' ? cls.name : cls;
        if (name) allSubjectNames.add(name);
    });
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
        // Updated to ask for Attended, Missed, and Cancelled
        div.innerHTML = `
            <h3><span class="subject-icon">${subjectMeta.icon || ''}</span> ${name}</h3>
            <div class="input-group">
                <div> <label for="prev-attended-${name}">Attended</label> <input type="number" id="prev-attended-${name}" min="0" value="0"> </div>
                <div> <label for="prev-missed-${name}">Missed</label> <input type="number" id="prev-missed-${name}" min="0" value="0"> </div>
                <div> <label for="prev-cancelled-${name}">Cancelled</label> <input type="number" id="prev-cancelled-${name}" min="0" value="0"> </div>
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
        const missedInput = document.getElementById(`prev-missed-${name}`);
        const cancelledInput = document.getElementById(`prev-cancelled-${name}`);
        if (!attendedInput || !missedInput || !cancelledInput) { continue; }

        const attended = parseInt(attendedInput.value) || 0;
        const missed = parseInt(missedInput.value) || 0;
        const cancelled = parseInt(cancelledInput.value) || 0;

        if (attended < 0 || missed < 0 || cancelled < 0) { 
            showNotification(`For ${name}, counts cannot be negative.`, 'error'); hasErrors = true; break; 
        }

        // Add subjects based on new status
        for (let i = 0; i < attended; i++) { previousSubjects.push({ name: name, status: 'attended' }); }
        for (let i = 0; i < missed; i++) { previousSubjects.push({ name: name, status: 'missed' }); }
        for (let i = 0; i < cancelled; i++) { previousSubjects.push({ name: name, status: 'cancelled' }); }
    }

    if (hasErrors) return;

    monthlyHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data");

    if (previousSubjects.length > 0) {
        const previousEntry = { day: 'N/A', date: 'N/A', month: 'Previous Data', subjects: previousSubjects };
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

    // Cancel new month form
    const cancelBtn = document.getElementById('cancel-new-month-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            newMonthForm.style.display = 'none';
        };
    }
}

function updateMonthLabel() {
    const label = document.getElementById('current-month-label');
    const attendanceMarkSection = document.getElementById('attendance-mark');
    if (!label || !attendanceMarkSection) return;

    label.textContent = currentMonthName ? `Current Month: ${currentMonthName}` : 'No month started';
    attendanceMarkSection.style.display = currentMonthName ? 'block' : 'none';
}

function showAttendanceForm() {
    const selectorsDiv = document.getElementById('date-day-selectors');
    if (!selectorsDiv) return;
    selectorsDiv.innerHTML = '';

    const dayLabel = document.createElement('label'); dayLabel.htmlFor = 'attendance-day-select'; dayLabel.textContent = 'Day:';
    const daySelect = document.createElement('select'); daySelect.id = 'attendance-day-select';
    DAYS.forEach(day => { daySelect.add(new Option(day, day)); });

    const dateLabel = document.createElement('label'); dateLabel.htmlFor = 'attendance-date'; dateLabel.textContent = 'Date:';
    const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.id = 'attendance-date';

    const dayWrapper = document.createElement('div'); dayWrapper.append(dayLabel, daySelect);
    const dateWrapper = document.createElement('div'); dateWrapper.append(dateLabel, dateInput);
    selectorsDiv.append(dayWrapper, dateWrapper);

    const renderSubjects = () => {
        const todayDiv = document.getElementById('today-classes');
        if (!todayDiv) return;
        todayDiv.innerHTML = '';
        const day = daySelect.value;
        todayDiv.innerHTML = `<h3>${day}</h3>`;

        const baseTimetableSubjects = (timetable[day] || []).map(cls => typeof cls === 'object' ? cls.name : cls);
        let subjectNames = [...baseTimetableSubjects];
        
        const dateVal = dateInput.value;
        const existingEntry = attendance.find(entry => entry.date === dateVal && dateVal);
        
        const isHoliday = holidays.find(h => dateVal >= h.start && dateVal <= h.end);
        
        if (existingEntry && existingEntry.subjects) {
            const existingSubjectsCopyForExtras = [...existingEntry.subjects];
            baseTimetableSubjects.forEach(name => {
                const idx = existingSubjectsCopyForExtras.findIndex(s => s.name === name);
                if (idx > -1) {
                    existingSubjectsCopyForExtras.splice(idx, 1);
                }
            });
            existingSubjectsCopyForExtras.forEach(extra => {
                subjectNames.push(extra.name);
            });
        }
        
        const existingSubjectsCopy = existingEntry ? [...existingEntry.subjects] : []; 
        
        if (isHoliday && !existingEntry) {
             todayDiv.innerHTML += `<div class="holiday-notice">🌴 <strong>${isHoliday.name}</strong> Holiday! No classes scheduled.</div>`;
             return;
        }
        
        if (!subjectNames.length) {
            todayDiv.innerHTML = '<p class="empty-state-message">No classes scheduled for this day.</p>';
        } else {
            // Iterate over ALL subjects, not unique ones
            subjectNames.forEach((name, index) => {
                const subjectMeta = subjectsMaster[name] || { icon: '', color: '#ccc' };
                
                // Find a matching subject from the copy and remove it to prevent re-matching
                let existingSubject = null;
                let existingSubjectIndex = -1;
                if (existingSubjectsCopy.length > 0) {
                    existingSubjectIndex = existingSubjectsCopy.findIndex(s => s.name === name);
                    if (existingSubjectIndex > -1) {
                        existingSubject = existingSubjectsCopy.splice(existingSubjectIndex, 1)[0]; // Find, remove, and get
                    }
                }
                const currentStatus = existingSubject?.status || 'missed'; // Default to 'missed' if no record

                const entryDiv = document.createElement('div');
                entryDiv.className = 'subject-entry';
                entryDiv.style.borderColor = subjectMeta.color;

                // Use the index to create a unique ID
                const idBase = `status-${name}-${index}-${dateVal}`; 
                
                entryDiv.innerHTML = `
                    <div class="subject-entry-header" style="color: ${subjectMeta.color};">
                        <span class="subject-icon">${subjectMeta.icon || ''}</span>
                        <span>${name}</span>
                    </div>
                    <div class="subject-status-group">
                        <input type="radio" id="${idBase}-attended" name="${idBase}" value="attended" ${currentStatus === 'attended' ? 'checked' : ''}>
                        <label for="${idBase}-attended" class="status-label status-attended">Attended</label>
                        
                        <input type="radio" id="${idBase}-missed" name="${idBase}" value="missed" ${currentStatus === 'missed' ? 'checked' : ''}>
                        <label for="${idBase}-missed" class="status-label status-missed">Missed</label>
                        
                        <input type="radio" id="${idBase}-cancelled" name="${idBase}" value="cancelled" ${currentStatus === 'cancelled' ? 'checked' : ''}>
                        <label for="${idBase}-cancelled" class="status-label status-cancelled">Cancelled</label>
                    </div>
                `;
                todayDiv.appendChild(entryDiv);
            });
        }
    };

    daySelect.addEventListener('change', renderSubjects);
    dateInput.addEventListener('change', (e) => {
        const date = e.target.value; if (!date) return;
        try { // Add try-catch for date parsing
            const [year, month, dayOfMonth] = date.split('-');
            const localDate = new Date(year, month - 1, dayOfMonth);
            const dayName = DAYS_OF_WEEK[localDate.getDay()];
            daySelect.value = dayName;
            renderSubjects(); // Re-render subjects which will now use the date to find records
        } catch (dateError) {
            console.error("Error processing date input:", dateError);
        }
    });

    const today = new Date();
    const dayName = DAYS_OF_WEEK[today.getDay()];
    daySelect.value = dayName;
    dateInput.valueAsDate = today;

    renderSubjects();
}

function submitAttendance(e) {
    e.preventDefault();
    if (!currentMonthName) { showNotification('Please start a new month first.', 'info'); return; }

    const day = document.getElementById('attendance-day-select')?.value;
    const date = document.getElementById('attendance-date')?.value;
    
    if (!day) { showNotification('Error: Could not read day selection.', 'error'); return; }
    if (!date) { showNotification('Please select a date.', 'error'); return; }

    const baseTimetableSubjects = (timetable[day] || []).map(cls => typeof cls === 'object' ? cls.name : cls);
    let subjectsToProcess = [...baseTimetableSubjects];
    
    // Check for manually added extra classes so they don't get overwritten
    const existingEntryIndexForSubmit = attendance.findIndex(entry => entry.date === date);
    if (existingEntryIndexForSubmit > -1) {
        const existingEntry = attendance[existingEntryIndexForSubmit];
        if (existingEntry && existingEntry.subjects) {
            const existingSubjectsCopyForExtras = [...existingEntry.subjects];
            baseTimetableSubjects.forEach(name => {
                const idx = existingSubjectsCopyForExtras.findIndex(s => s.name === name);
                if (idx > -1) {
                    existingSubjectsCopyForExtras.splice(idx, 1);
                }
            });
            existingSubjectsCopyForExtras.forEach(extra => {
                subjectsToProcess.push(extra.name);
            });
        }
    }

    const newSubjectsData = [];

    // Iterate over ALL subjects, using the index
    subjectsToProcess.forEach((name, index) => {
        if (!subjectsMaster[name]) return; // Skip if subject was deleted
        
        // Use index to find the unique radio button group
        const idBase = `status-${name}-${index}-${date}`;
        const selectedInput = document.querySelector(`input[name="${idBase}"]:checked`);
        const status = selectedInput ? selectedInput.value : 'missed'; // Default to missed
        newSubjectsData.push({ name: name, status: status });
    });

    if (newSubjectsData.length === 0) {
         showNotification('No subjects scheduled for this day.', 'info', null, 'Nothing to Save');
         return;
    }

    // Use DATE as the unique key
    const existingEntryIndex = attendance.findIndex(entry => entry.date === date);

    if (existingEntryIndex > -1) {
        attendance[existingEntryIndex].subjects = newSubjectsData;
        attendance[existingEntryIndex].day = day; // Ensure day is updated
    } else {
        attendance.push({ day, date, month: currentMonthName, subjects: newSubjectsData });
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

    // Set the default date for the new view-by-date input
    const viewDateInput = document.getElementById('view-date-input');
    if (viewDateInput && !viewDateInput.value) {
        viewDateInput.valueAsDate = new Date();
    }
    // Hide the results card by default
    const viewDateResults = document.getElementById('view-date-results');
    if (viewDateResults) {
        viewDateResults.style.display = 'none';
        viewDateResults.innerHTML = '';
    }

    renderCalendar(); // New calendar
    showAttendanceTable();
    showAllMonthsAttendance();
    showCompleteAttendance();
    populateProjectionSubjects(); // Update projection dropdown
    renderInsightsDashboard(); 
    renderBunkManager(); // NEW: Call Bunk Manager render
}

// *** NEW FEATURE: Show Attendance for Specific Date ***
function showAttendanceForDate() {
    const dateInput = document.getElementById('view-date-input');
    const resultsDiv = document.getElementById('view-date-results');
    if (!dateInput || !resultsDiv) return;

    const selectedDate = dateInput.value;
    if (!selectedDate) {
        showNotification('Please select a date to view.', 'info');
        return;
    }

    const allEntries = getAllAttendanceEntries();
    const entry = allEntries.find(e => e.date === selectedDate);

    resultsDiv.style.display = 'block'; // Show the results card

    if (!entry || !entry.subjects || entry.subjects.length === 0) {
        resultsDiv.innerHTML = `<h3>Attendance for ${selectedDate}</h3><div class="empty-state"><p>No attendance recorded for this date.</p></div>`;
        return;
    }

    let resultsHTML = `<h3>Attendance for ${selectedDate} (Day: ${entry.day})</h3>`;
    resultsHTML += '<div class="view-date-subjects-list">';

    resultsHTML += entry.subjects.map(s => {
        if (!s || !s.name) return '';
        const subjectMeta = subjectsMaster[s.name] || { icon: '', color: '#ccc'};
        let cellClass = '';
        switch (s.status) {
            case 'attended': cellClass = 'subject-cell-attended'; break;
            case 'missed': cellClass = 'subject-cell-missed'; break;
            case 'cancelled': cellClass = 'subject-cell-cancelled'; break;
            default: cellClass = 'subject-cell-missed';
        }
        // Re-use the .subject-cell styling from the table
        return `<span class="subject-cell ${cellClass}" style="--subject-color: ${subjectMeta.color};"><span class="subject-icon">${subjectMeta.icon || ''}</span> ${s.name}</span>`;
    }).join('');

    resultsHTML += '</div>';
    resultsDiv.innerHTML = resultsHTML;
}
// *** END NEW FEATURE ***

function showAttendanceTable() {
    const container = document.getElementById('attendance-table-container');
    if (!container) return;
    container.innerHTML = '<h3>Current Month Attendance</h3>';
    let tableHTML = `<table class="attendance-table"><thead><tr><th>Date</th><th>Day</th><th>Subjects</th></tr></thead><tbody>`;
    // Sort by date
    const sortedAttendance = [...attendance].sort((a, b) => {
        if (a.date && b.date) return new Date(a.date) - new Date(b.date);
        if (a.date) return 1; // Entries with dates first
        if (b.date) return -1;
        return DAYS.indexOf(a.day) - DAYS.indexOf(b.day); // Fallback to day sort
    });

    sortedAttendance.forEach(entry => {
        tableHTML += `<tr>
            <td>${entry.date || ''}</td>
            <td>${entry.day}</td>
            <td>${entry.subjects?.map(s => {
                if (!s || !s.name) return '';
                const subjectMeta = subjectsMaster[s.name] || { icon: '', color: '#ccc'};
                let cellClass = '';
                switch (s.status) {
                    case 'attended': cellClass = 'subject-cell-attended'; break;
                    case 'missed': cellClass = 'subject-cell-missed'; break;
                    case 'cancelled': cellClass = 'subject-cell-cancelled'; break;
                    default: cellClass = 'subject-cell-missed';
                }
                return `<span class="subject-cell ${cellClass}" style="--subject-color: ${subjectMeta.color};"><span class="subject-icon">${subjectMeta.icon || ''}</span> ${s.name}</span>`;
            }).join('') || '<span class="no-subjects-note">No scheduled classes</span>'}</td>
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
        monthEntry.attendance?.forEach(entry => { 
            entry.subjects?.forEach(s => { 
                if(s && s.name && subjectsMaster[s.name] && s.status !== 'cancelled'){ 
                    if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0}; 
                    subjectTotals[s.name].total += 1; 
                    if (s.status === 'attended') subjectTotals[s.name].attended += 1; 
                }
            }); 
        });
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
    
    // Bunk Dashboard
    const bunkGrid = document.getElementById('bunk-stats-grid');
    if (bunkGrid) bunkGrid.innerHTML = '';
    let bunkerWidgets = '';

    Object.keys(subjectTotals).sort().forEach(name => {
        const { attended, total } = subjectTotals[name];
        const subjectMeta = subjectsMaster[name] || { icon: '', color: '#ccc'};
        const percentNum = total ? (attended / total) * 100 : 0;
        const percent = percentNum.toFixed(2);
        let bunkerInfo = '', barColorClass = 'bar-primary';

        if (total === 0) { bunkerInfo = '<span class="bunker-info">No classes recorded yet.</span>'; barColorClass = 'bar-neutral'; }
        else if (percentNum >= goalPercent) {
             const bunksAvailable = (goal > 0) ? Math.floor((attended - (goal * total)) / goal) : Infinity; 
             bunkerInfo = `<span class="bunker-info bunks-available">Can miss ${bunksAvailable} class${bunksAvailable !== 1 ? 'es' : ''}.</span>`;
             barColorClass = 'bar-success';
             bunkerWidgets += `<div class="bunk-stat stat-safe" style="border-left-color: ${subjectMeta.color}"><span class="subject-icon">${subjectMeta.icon || ''}</span> ${name}: <strong>Safe to skip ${bunksAvailable}</strong></div>`;
        } else {
             const classesNeeded = (goal >= 1) ? (total - attended) : Math.ceil(((goal * total) - attended) / (1 - goal));
             bunkerInfo = `<span class="bunker-info bunks-needed">Need ${classesNeeded} class${classesNeeded !== 1 ? 'es' : ''} for ${goalPercent}%.</span>`;
             if (percentNum < 50) barColorClass = 'bar-danger'; else barColorClass = 'bar-warning';
             bunkerWidgets += `<div class="bunk-stat stat-danger" style="border-left-color: ${subjectMeta.color}"><span class="subject-icon">${subjectMeta.icon || ''}</span> ${name}: <strong>Need to attend ${classesNeeded}</strong></div>`;
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
    if (bunkGrid) {
        if (!bunkerWidgets) bunkerWidgets = '<p class="empty-state-message">Track some classes to see personalized Bunk strategies.</p>';
        bunkGrid.innerHTML = bunkerWidgets;
    }
    drawAttendanceChart(chartLabels, chartData, chartColors, subjectTotals, overallAverage);
}

function calculateSubjectTotals() {
    let totals = {};
    const processEntry = (entry) => {
        entry?.subjects?.forEach(s => {
             // *** UPDATED LOGIC ***
             // Only count if subject exists and status is NOT cancelled
             if (s && s.name && subjectsMaster[s.name] && s.status !== 'cancelled') {
                 if (!totals[s.name]) totals[s.name] = {attended: 0, total: 0};
                 totals[s.name].total += 1; // It was a class that was held
                 if (s.status === 'attended') {
                    totals[s.name].attended += 1; // It was attended
                 }
                 // If status is 'missed', only total goes up, attended does not
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
    if (!Chart) { console.warn("Chart.js not loaded, skipping chart render."); return; }

    if (attendanceChart) { attendanceChart.destroy(); }

    const style = getComputedStyle(document.body);
    const gridColor = style.getPropertyValue('--chart-grid-color').trim() || 'rgba(0,0,0,0.1)';
    const labelColor = style.getPropertyValue('--text-light').trim() || '#666';
    const titleColor = style.getPropertyValue('--text-dark').trim() || '#222';
    const dangerColor = style.getPropertyValue('--danger-color').trim() || '#ff3b30';
    const goalPercent = parseFloat(localStorage.getItem('attendance_goal')) || 75;

    const getLuminance = (hex) => {
        try {
            let c = hex.substring(1); // strip #
            if (c.length === 3) c = c.split('').map(v => v + v).join('');
            const rgb = parseInt(c, 16);
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = (rgb >> 0) & 0xff;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        } catch(e) { return 100; } // Default to light
    };

    attendanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Attendance %',
                data: data,
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace(')', ', 0.7)').replace('rgb(', 'rgba(')), // Add some transparency to border
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Horizontal bar chart
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: { color: labelColor, callback: (value) => value + '%' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: labelColor, font: { weight: '600' } }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: `Overall Attendance: ${overallAverage.toFixed(2)}%`,
                    color: titleColor,
                    font: { size: 16, weight: '700' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.raw.toFixed(2);
                            const subjName = context.label.trim().split(' ').slice(1).join(' ') || context.label.trim(); // Get name, remove icon
                            const totals = subjectTotals[subjName];
                            if (totals) { return `${label}: ${value}% (${totals.attended}/${totals.total})`; }
                            return `${label}: ${value}%`;
                        }
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'right',
                    formatter: (value) => value.toFixed(1) + '%',
                    color: (context) => {
                        // Use datalabel color based on bar color luminance
                        const barColor = context.dataset.backgroundColor[context.dataIndex];
                        return getLuminance(barColor) > 140 ? '#333' : '#f5f5f7';
                    },
                    font: { weight: 'bold', size: 10 },
                    textShadowBlur: 2,
                    textShadowColor: (context) => {
                         const barColor = context.dataset.backgroundColor[context.dataIndex];
                        return getLuminance(barColor) > 140 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
                    }
                },
                annotation: { // Add goal line
                    annotations: {
                        goalLine: {
                            type: 'line',
                            xMin: goalPercent,
                            xMax: goalPercent,
                            borderColor: dangerColor,
                            borderWidth: 2,
                            borderDash: [6, 6],
                            label: {
                                content: `Goal: ${goalPercent}%`,
                                display: true,
                                position: 'start',
                                backgroundColor: 'rgba(0,0,0,0.05)',
                                color: dangerColor,
                                font: { weight: 'bold' }
                            }
                        }
                    }
                }
            }
        },
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

// --- NEW Helper to get all attendance data ---
function getAllAttendanceEntries() {
    let allEntries = [...attendance]; // Start with current month's data
    monthlyHistory.forEach(month => {
        if (month.attendance) {
            allEntries = allEntries.concat(month.attendance);
        }
    });
    // Filter out any entries that don't have a date (like 'Previous Data' placeholder)
    return allEntries.filter(entry => entry.date && entry.date !== 'N/A');
}

// --- Calendar ---
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYearLabel = document.getElementById('calendar-month-year');
    if (!grid || !monthYearLabel) return;

    // *** FIX: Get ALL entries, not just the current 'attendance' array ***
    const allEntries = getAllAttendanceEntries();
    // Create a Map for fast lookups
    const entriesByDate = new Map(allEntries.map(entry => [entry.date, entry]));

    grid.innerHTML = '';
    const year = calendarView.getFullYear();
    const month = calendarView.getMonth(); // 0-indexed
    
    monthYearLabel.textContent = calendarView.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Get weekday, adjust Sunday (0) to be 6
    let startingDay = firstDayOfMonth.getDay() - 1;
    if (startingDay < 0) startingDay = 6; 
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Add empty cells for padding
    for (let i = 0; i < startingDay; i++) {
        grid.innerHTML += '<div class="calendar-day empty"></div>';
    }

    // Add day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // *** FIX: Use the Map to find the entry ***
        const entry = entriesByDate.get(dateStr); 
        const isHoliday = holidays.find(h => dateStr >= h.start && dateStr <= h.end);
        
        let dayClass = 'calendar-day';

        if (isHoliday) {
            dayClass += ' day-holiday';
        } else if (entry && entry.subjects && entry.subjects.length > 0) {
            dayClass += ' has-data';
            const hasMissed = entry.subjects.some(s => s.status === 'missed');
            const allCancelled = entry.subjects.every(s => s.status === 'cancelled');
            
            if (hasMissed) {
                dayClass += ' day-bad';
            } else if (!allCancelled) {
                dayClass += ' day-good';
            } else {
                 dayClass += ' day-mixed'; // All cancelled or no subjects
            }
        }
        
        if (dateStr === todayStr) {
            dayClass += ' today';
        }

        grid.innerHTML += `<div class="${dayClass}">${day}</div>`;
    }
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
 }
 function hideNotification() {
     const overlay = document.getElementById('custom-notification-overlay');
     const box = document.getElementById('custom-notification-box');
     if (!overlay || !box) return;

     overlay.classList.add('is-hiding'); // Start fade out

     const onTransitionEnd = () => {
         overlay.classList.add('hidden');
         overlay.classList.remove('is-hiding');
         notificationConfirmCallback = null; // Clear callback only after hidden
         overlay.removeEventListener('transitionend', onTransitionEnd); // Clean up listener
     };
     overlay.addEventListener('transitionend', onTransitionEnd);

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
     document.getElementById('custom-notification-overlay')?.addEventListener('click', (e) => {
         if (e.target === e.currentTarget) { // Only if clicking overlay itself
             const confirmBtn = document.getElementById('custom-notification-confirm');
             if (!confirmBtn || confirmBtn.style.display === 'none') {
                 hideNotification();
             }
         }
     });
 }

function showCustomPrompt(title, placeholder = '') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-notification-overlay');
        const box = document.getElementById('custom-notification-box');
        const msgEl = document.getElementById('custom-notification-message');
        const titleEl = document.getElementById('custom-notification-title');
        const inputEl = document.getElementById('custom-notification-input');
        const confirmBtn = document.getElementById('custom-notification-confirm');
        const cancelBtn = document.getElementById('custom-notification-cancel');
        const okBtn = document.getElementById('custom-notification-ok');
        
        okBtn.style.display = 'none';
        confirmBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
        inputEl.classList.remove('hidden');
        
        titleEl.textContent = 'Input Required';
        msgEl.innerHTML = title;
        inputEl.value = placeholder;
        
        box.className = 'prompt';
        overlay.classList.remove('hidden', 'is-hiding');
        inputEl.focus();

        const cleanup = () => {
            overlay.classList.add('hidden');
            inputEl.classList.add('hidden');
            confirmBtn.replaceWith(confirmBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
            inputEl.replaceWith(inputEl.cloneNode(true));
            // Re-attach notification listeners since we replaced the buttons
            setupNotificationListeners();
        };

        const newConfirmBtn = document.getElementById('custom-notification-confirm');
        const newCancelBtn = document.getElementById('custom-notification-cancel');
        const newInputEl = document.getElementById('custom-notification-input');

        newConfirmBtn.addEventListener('click', () => { resolve(newInputEl.value); cleanup(); });
        newCancelBtn.addEventListener('click', () => { resolve(null); cleanup(); });
        newInputEl.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') newConfirmBtn.click();
            if (e.key === 'Escape') newCancelBtn.click();
        });
    });
}


// --- Mark Day as Holiday ---
function markDayAsHoliday() {
    console.log('markDayAsHoliday called');
    if (!currentMonthName) { showNotification('Please start a new month first.', 'info'); return; }

    const day = document.getElementById('attendance-day-select')?.value;
    const date = document.getElementById('attendance-date')?.value;

    if (!day) { showNotification('Error: Could not read day selection.', 'error'); return; }
    if (!date) { showNotification('Please select a date.', 'error'); return; }

    const baseTimetableSubjects = (timetable[day] || []).map(cls => typeof cls === 'object' ? cls.name : cls);

    // Also include any extra subjects already on this date
    let subjectsToProcess = [...baseTimetableSubjects];
    const existingEntry = attendance.find(entry => entry.date === date);
    if (existingEntry && existingEntry.subjects) {
        const existingCopy = [...existingEntry.subjects];
        baseTimetableSubjects.forEach(name => {
            const idx = existingCopy.findIndex(s => s.name === name);
            if (idx > -1) existingCopy.splice(idx, 1);
        });
        existingCopy.forEach(extra => subjectsToProcess.push(extra.name));
    }

    if (subjectsToProcess.length === 0) {
        showNotification('No classes scheduled for this day.', 'info', null, 'Nothing to Mark');
        return;
    }

    showNotification(`Mark all ${subjectsToProcess.length} class(es) on ${date} as Holiday (Cancelled)?`, 'confirm', () => {
        const cancelledSubjects = subjectsToProcess.map(name => ({ name, status: 'cancelled' }));

        const existingIdx = attendance.findIndex(entry => entry.date === date);
        if (existingIdx > -1) {
            attendance[existingIdx].subjects = cancelledSubjects;
            attendance[existingIdx].day = day;
        } else {
            attendance.push({ day, date, month: currentMonthName, subjects: cancelledSubjects });
        }

        saveToLocal();
        showResults();
        showAttendanceForm(); // Refresh to show updated status
        showNotification(`All classes on ${date} marked as Holiday (Cancelled).`, 'success');
    }, 'Mark as Holiday');
}

// --- Back Navigation ---
function goBackToTimetable() {
    console.log('goBackToTimetable called');
    // Hide all downstream sections
    const sectionsToHide = ['previous-attendance-setup', 'month-controls', 'attendance-mark', 'projections', 'results', 'insights-dashboard'];
    sectionsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // Show timetable setup
    const timetableSetup = document.getElementById('timetable-setup');
    if (timetableSetup) {
        timetableSetup.style.display = 'block';
        createTimetableInputs();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function removeAllRecords() { 
    showNotification( 'Delete all records? This will clear your timetable, subjects, and all attendance history. Cannot be undone.', 'confirm', () => { 
        localStorage.clear(); 
        timetable = {}; 
        attendance = []; 
        monthlyHistory = []; 
        currentMonthName = null; 
        subjectsMaster = {}; 
        location.reload(); 
    }, 'Confirm Delete All'); 
}

function deleteDayAttendance() {
    const date = document.getElementById('attendance-date')?.value;
    if (!date) {
        showNotification(`Please select a date to delete.`, 'info');
        return;
    }
    const existingEntryIndex = attendance.findIndex(entry => entry.date === date);
    if (existingEntryIndex === -1) {
        showNotification(`No attendance recorded for ${date} to delete.`, 'info');
        return;
    }
    showNotification(`Delete all attendance for ${date}?`, 'confirm', () => {
        attendance.splice(existingEntryIndex, 1);
        saveToLocal();
        showResults();
        showAttendanceForm(); // Refresh form
        showNotification(`Attendance for ${date} deleted.`, 'success');
    }, 'Confirm Deletion');
}

function toggleModifyForm(show = false, mode = 'add') {
    const form = document.getElementById('modify-subject-form');
    const title = document.getElementById('modify-form-title');
    const action = document.getElementById('modify-action');
    const statusWrapper = document.getElementById('modify-status-wrapper');
    const newDateFields = document.getElementById('new-date-fields');
    if (!form || !title || !action || !statusWrapper || !newDateFields) return;

    if (show) {
        form.classList.remove('hidden');
        action.value = mode;
        if (mode === 'add') {
            title.textContent = 'Add Subject to Date';
            statusWrapper.classList.remove('hidden');
            newDateFields.classList.remove('hidden');
        } else {
            title.textContent = 'Remove Subject from Date';
            statusWrapper.classList.add('hidden');
            newDateFields.classList.add('hidden');
        }
        // Reset form fields
        document.getElementById('modify-date').valueAsDate = new Date();
        document.getElementById('modify-subject').value = '';
        document.getElementById('modify-status-attended').checked = true; // Default to attended
        checkNewDate(); // Auto-fill day
    } else {
        form.classList.add('hidden');
    }
}

function handleModifySubject(e) {
    e.preventDefault();
    const action = document.getElementById('modify-action').value;
    const date = document.getElementById('modify-date').value;
    const subjectName = document.getElementById('modify-subject').value.trim();
    const day = document.getElementById('modify-day').value;
    const status = document.querySelector('input[name="modify-status"]:checked')?.value || 'attended';

    if (!date || !subjectName || !day) {
        showNotification('Please fill in all fields.', 'error'); return;
    }
    if (!subjectsMaster[subjectName]) {
        showNotification(`Subject "${subjectName}" not found. Please add it to your timetable or check spelling.`, 'error'); return;
    }
    if (!currentMonthName) {
        showNotification('Please start a month before modifying attendance.', 'info'); return;
    }

    // Find or create the attendance entry for this date
    let entryIndex = attendance.findIndex(entry => entry.date === date);
    let entry;
    if (entryIndex === -1) {
        // If 'add' and no entry, create one
        if (action === 'add') {
             entry = { day, date, month: currentMonthName, subjects: [] };
             attendance.push(entry);
             entryIndex = attendance.length - 1;
        } else {
            // If 'remove' and no entry, nothing to do
            showNotification(`No attendance found for ${date} to remove a subject from.`, 'info'); return;
        }
    } else {
        entry = attendance[entryIndex];
        // Ensure day is updated
        entry.day = day;
    }

    const subjectIndex = entry.subjects.findIndex(s => s.name === subjectName);

    if (action === 'add') {
        const newSubjectData = { name: subjectName, status: status };
        entry.subjects.push(newSubjectData); // Add new (always push to allow duplicates)
        showNotification(`Subject "${subjectName}" added to ${date}.`, 'success');
    } else { // action === 'remove'
        if (subjectIndex > -1) {
            entry.subjects.splice(subjectIndex, 1);
            showNotification(`Subject "${subjectName}" removed from ${date}.`, 'success');
        } else {
            showNotification(`Subject "${subjectName}" was not found on ${date}.`, 'info'); return;
        }
        // If last subject is removed, remove the whole entry
        if (entry.subjects.length === 0) {
            attendance.splice(entryIndex, 1);
        }
    }
    
    saveToLocal();
    showResults();
    showAttendanceForm(); // Refresh form
    toggleModifyForm(false); // Hide form
}

function checkNewDate(e) {
    const dateInput = e ? e.target : document.getElementById('modify-date');
    const dayInput = document.getElementById('modify-day');
    if (!dateInput.value || !dayInput) return;

    try {
        const [year, month, dayOfMonth] = dateInput.value.split('-');
        const localDate = new Date(year, month - 1, dayOfMonth);
        const dayName = DAYS_OF_WEEK[localDate.getDay()];
        dayInput.value = dayName;
    } catch (dateError) {
        console.error("Error processing date input:", dateError);
        dayInput.value = '';
    }
}

// --- Smart Insights & Gamification --- //

function renderBunkManager() {
    const grid = document.getElementById('bunk-stats-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (attendance.length === 0) {
        grid.innerHTML = '<p class="empty-state-message" style="grid-column: 1/-1;">Log attendance to see bunk stats.</p>';
        return;
    }

    const goalPercent = parseFloat(localStorage.getItem('attendance_goal')) || 75;
    const goal = goalPercent / 100.0;
    
    const subjectTotals = calculateSubjectTotals();
    
    Object.keys(subjectTotals).forEach(name => {
        const stats = subjectTotals[name];
        if (stats.total === 0) return;
        
        let safeToBunk = 0;
        let classesNeeded = 0;
        let msg = '';
        let statClass = '';
        const currentPct = (stats.attended / stats.total) * 100;
        
        if (currentPct >= goalPercent) {
            safeToBunk = Math.floor((stats.attended - goal * stats.total) / goal);
            if (safeToBunk > 0) {
                msg = `Safe to bunk <strong>${safeToBunk}</strong> class${safeToBunk > 1 ? 'es' : ''}`;
                statClass = 'stat-safe';
            } else {
                msg = `On track (Cannot bunk)`;
                statClass = 'stat-safe';
            }
        } else {
            classesNeeded = Math.ceil((goal * stats.total - stats.attended) / (1 - goal));
            msg = `Need <strong>${classesNeeded}</strong> class${classesNeeded > 1 ? 'es' : ''}`;
            statClass = 'stat-danger';
        }
        
        const card = document.createElement('div');
        card.className = `bunk-stat ${statClass}`;
        card.innerHTML = `<div style="flex:1"><strong>${name}</strong> <span style="display:block; font-size: 0.8rem; color: #666;">${currentPct.toFixed(1)}%</span></div> <div>${msg}</div>`;
        grid.appendChild(card);
    });
}

function renderInsightsDashboard() {
    const dashboard = document.getElementById('insights-dashboard');
    if (!dashboard) return;

    let streak = 0;
    const sortedDates = [...attendance].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    for (let i = 0; i < sortedDates.length; i++) {
         const entry = sortedDates[i];
         const hasAttended = entry.subjects.some(s => s.status === 'attended');
         const hasMissed = entry.subjects.some(s => s.status === 'missed');
         
         if (hasAttended && !hasMissed) {
             streak++;
         } else if (hasMissed) {
             break;
         }
    }
    const currentStreakEl = document.getElementById('current-streak');
    if (currentStreakEl) currentStreakEl.innerText = `${streak} Day${streak !== 1 ? 's' : ''}`;

    let bestSubject = '--', worstSubject = '--';
    let highestPct = -1, lowestPct = 101;
    
    const subjectTotals = {};
    attendance.forEach(entry => {
        entry.subjects.forEach(sub => {
            if (sub.status === 'cancelled') return;
            if (!subjectTotals[sub.name]) subjectTotals[sub.name] = { attended: 0, total: 0 };
            subjectTotals[sub.name].total++;
            if (sub.status === 'attended') subjectTotals[sub.name].attended++;
        });
    });

    Object.keys(subjectTotals).forEach(name => {
        const stats = subjectTotals[name];
        if (stats.total > 0) {
            const pct = (stats.attended / stats.total) * 100;
            if (pct > highestPct) { highestPct = pct; bestSubject = name; }
            if (pct < lowestPct) { lowestPct = pct; worstSubject = name; }
        }
    });

    const bestSubEl = document.getElementById('best-subject');
    const worstSubEl = document.getElementById('worst-subject');
    if (bestSubEl) bestSubEl.innerText = highestPct >= 0 ? `${bestSubject} (${Math.round(highestPct)}%)` : '--';
    if (worstSubEl) worstSubEl.innerText = lowestPct <= 100 ? `${worstSubject} (${Math.round(lowestPct)}%)` : '--';

    const dayTotals = {};
    attendance.forEach(entry => {
        if (!dayTotals[entry.day]) dayTotals[entry.day] = { attended: 0, total: 0 };
        entry.subjects.forEach(sub => {
             if (sub.status === 'cancelled') return;
             dayTotals[entry.day].total++;
             if (sub.status === 'attended') dayTotals[entry.day].attended++;
        });
    });
    
    let bestDayName = '--', bestDayPct = -1;
    Object.keys(dayTotals).forEach(day => {
         const stats = dayTotals[day];
         if (stats.total > 0) {
              const pct = (stats.attended / stats.total) * 100;
              if (pct > bestDayPct) { bestDayPct = pct; bestDayName = day; }
         }
    });
    
    const bestDayEl = document.getElementById('best-day');
    if (bestDayEl) bestDayEl.innerText = bestDayPct >= 0 ? `${bestDayName} (${Math.round(bestDayPct)}%)` : '--';

    evaluateBadges(streak, highestPct, Object.keys(subjectTotals).length);
    renderWeeklyTrendChart();
}

function evaluateBadges(streak, highestPct, totalSubjects) {
     const badges = [];
     if (streak >= 3) badges.push({ icon: '🔥', title: 'On Fire!', desc: '3+ Day Streak' });
     if (streak >= 7) badges.push({ icon: '😎', title: 'Unstoppable', desc: '7+ Day Streak' });
     if (highestPct === 100 && totalSubjects > 0) badges.push({ icon: '⭐', title: 'Perfectionist', desc: '100% in a subject' });
     
     const totalClasses = attendance.reduce((acc, entry) => acc + entry.subjects.length, 0);
     if (totalClasses >= 10) badges.push({ icon: '📚', title: 'Committed', desc: 'Tracked 10+ classes' });
     if (totalClasses >= 50) badges.push({ icon: '🎓', title: 'Veteran', desc: 'Tracked 50+ classes' });
     
     const container = document.getElementById('badges-grid');
     const msg = document.getElementById('no-badges-msg');
     
     if (badges.length === 0) {
         container.innerHTML = `<p class="empty-state-message" id="no-badges-msg">Keep attending classes to unlock badges!</p>`;
         return;
     }
     
     container.innerHTML = '';
     badges.forEach(b => {
          container.innerHTML += `
               <div class="badge-item" style="text-align: center; padding: 1rem; background: var(--input-bg); border: 2px solid ${b.icon === '⭐' ? 'gold' : 'var(--border-color)'}; border-radius: var(--border-radius-md); width: 130px; box-shadow: 0 4px 6px var(--shadow-color); transition: transform 0.2s;">
                   <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">${b.icon}</div>
                   <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 0.25rem;">${b.title}</div>
                   <div style="font-size: 0.75rem; color: var(--text-light); line-height: 1.2;">${b.desc}</div>
               </div>
          `;
     });
}

function renderWeeklyTrendChart() {
    const ctx = document.getElementById('weekly-trend-chart');
    if (!ctx) return;
    
    const weeks = {};
    attendance.forEach(entry => {
         if(!entry.date) return;
         const d = new Date(entry.date);
         
         const label = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleString('default', { month: 'short' })}`;
         
         if(!weeks[label]) weeks[label] = { attended: 0, total: 0, dateObj: d };
         
         entry.subjects.forEach(sub => {
              if (sub.status !== 'cancelled') {
                   weeks[label].total++;
                   if (sub.status === 'attended') weeks[label].attended++;
              }
         });
    });

    const sortedWeeksObj = Object.values(weeks).sort((a,b) => a.dateObj - b.dateObj);
    const lastWeeks = sortedWeeksObj.slice(-6);
    
    const labels = lastWeeks.map(w => {
         return `W${Math.ceil(w.dateObj.getDate() / 7)} ${w.dateObj.toLocaleString('default', { month: 'short' })}`;
    });
    const data = lastWeeks.map(w => w.total > 0 ? (w.attended / w.total * 100).toFixed(1) : 0);

    if (window.weeklyTrendChartInstance) window.weeklyTrendChartInstance.destroy();
    
    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-accent').trim() || '#007aff';
    
    window.weeklyTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Weekly Att %',
                data: data,
                borderColor: primaryColor,
                backgroundColor: primaryColor + '33',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: primaryColor,
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { min: 0, max: 100 } },
            plugins: { legend: { display: false } }
        }
    });
}

function toggleReminders() {
    const time = document.getElementById('reminder-time').value;
    const btn = document.getElementById('enable-reminders-btn');
    
    if (btn.innerText.includes('Enable')) {
         if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
             Notification.requestPermission();
         }
         localStorage.setItem('attendance_reminder_time', time);
         btn.innerText = 'Disable Reminders';
         btn.classList.add('button-danger');
         btn.classList.remove('button-secondary');
         showNotification(`Reminders securely set for ${time} daily.`, 'success');
         startReminderLoop();
    } else {
         localStorage.removeItem('attendance_reminder_time');
         btn.innerText = 'Enable Reminders';
         btn.classList.remove('button-danger');
         btn.classList.add('button-secondary');
         if(window.reminderInterval) clearInterval(window.reminderInterval);
         showNotification('Reminders disabled.', 'info');
    }
}

function startReminderLoop() {
    if(window.reminderInterval) clearInterval(window.reminderInterval);
    const target = localStorage.getItem('attendance_reminder_time');
    if (!target) return;
    
    const btn = document.getElementById('enable-reminders-btn');
    if (btn) {
        btn.innerText = 'Disable Reminders';
        btn.classList.add('button-danger');
        btn.classList.remove('button-secondary');
        document.getElementById('reminder-time').value = target;
    }

    window.reminderInterval = setInterval(() => {
        const timeTarget = localStorage.getItem('attendance_reminder_time');
        if (!timeTarget) return;
        
        const now = new Date();
        const currentHr = now.getHours().toString().padStart(2, '0');
        const currentMin = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHr}:${currentMin}`;
        
        const lastNotified = localStorage.getItem('attendance_last_notified');
        const todayStr = now.toDateString();
        
        if (currentTime === timeTarget && lastNotified !== todayStr) {
            localStorage.setItem('attendance_last_notified', todayStr);
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification("Attendance Calculator", {
                     body: "Hey! Don't forget to mark your attendance for today's classes.",
                     icon: "assets/icon-192.png"
                });
            } else {
                showNotification("⏰ Time to log your attendance for today's classes!", "info");
            }
        }
    }, 60000); 
}

function exportData() {
    try {
        const data = {
            timetable: timetable,
            subjectsMaster: subjectsMaster,
            attendance: attendance,
            monthlyHistory: monthlyHistory,
            currentMonthName: currentMonthName,
            attendance_goal: localStorage.getItem('attendance_goal') || '75',
            theme: localStorage.getItem('theme') || 'light',
            accent_color: localStorage.getItem('accent_color') || '#007aff'
        };
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
        a.download = `attendance_backup_${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification('Data exported successfully!', 'success');
    } catch (e) {
        console.error("Error exporting data:", e);
        showNotification('Failed to export data.', 'error', null, 'Export Error');
    }
}

// New CSV Export Function
function exportReportToCSV() {
    try {
        const subjectTotals = calculateSubjectTotals();
        let csvContent = "data:text/csv;charset=utf-8,";
        
        csvContent += `Profile/Semester:,${currentProfileId}\n\n`;
        csvContent += "Subject,Classes Attended,Classes Held,Attendance %,Safe To Bunk / Classes Needed\n";

        let grandAttended = 0;
        let grandTotal = 0;

        const sortedNames = Object.keys(subjectTotals).sort();
        const goalPercent = parseFloat(localStorage.getItem('attendance_goal')) || 75;
        const goal = goalPercent / 100.0;
        
        sortedNames.forEach(name => {
            const { attended, total } = subjectTotals[name];
            const percent = total > 0 ? (attended / total * 100) : 0;
            const percentStr = percent.toFixed(2) + "%";
            
            let statusStr = '';
            if (percent >= goalPercent) {
                const safeToBunk = Math.floor((attended - goal * total) / goal);
                statusStr = safeToBunk > 0 ? `Safe to bunk ${safeToBunk}` : 'On track';
            } else {
                const classesNeeded = Math.ceil((goal * total - attended) / (1 - goal));
                statusStr = `Need ${classesNeeded}`;
            }

            csvContent += `"${name}",${attended},${total},"${percentStr}","${statusStr}"\n`;
            grandAttended += attended;
            grandTotal += total;
        });

        const overallPercent = grandTotal > 0 ? (grandAttended / grandTotal * 100).toFixed(2) : '0.00';
        csvContent += `\nTotal Overall,${grandAttended},${grandTotal},"${overallPercent}%",\n`;
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
        a.download = `attendance_report_${date}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error("Error exporting CSV report:", e);
        showNotification('Failed to export report.', 'error', null, 'Export Error');
    }
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/json') {
        showNotification('Invalid file type. Please select a .json backup file.', 'error', null, 'Import Error');
        return;
    }
    
    showNotification('Importing data will overwrite all current settings and records. This cannot be undone.', 'confirm', () => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                
                // Clear existing data first
                localStorage.clear();
                
                // --- Check for NEW format (v2, v3) ---
                if (data.timetable && typeof data.timetable === 'object' && data.subjectsMaster) {
                    console.log("Importing new format...");
                    timetable = data.timetable || {};
                    subjectsMaster = data.subjectsMaster || {};
                    attendance = data.attendance || [];
                    monthlyHistory = data.monthlyHistory || [];
                    currentMonthName = data.currentMonthName || null;
                    
                    localStorage.setItem('attendance_goal', data.attendance_goal || '75');
                    localStorage.setItem('theme', data.theme || 'light');
                    localStorage.setItem('accent_color', data.accent_color || '#007aff');

                // --- Check for OLD format (v1, stringified JSON) ---
                } else if (data.timetable && typeof data.timetable === 'string' && data.attendance_data) {
                    console.log("Importing old format (v1)...");
                    timetable = JSON.parse(data.timetable || '{}');
                    attendance = JSON.parse(data.attendance_data || '[]');
                    monthlyHistory = JSON.parse(data.monthly_history || '[]');
                    currentMonthName = data.current_month || null;
                    subjectsMaster = {}; // Will be rebuilt
                    
                    localStorage.setItem('attendance_goal', data.attendance_goal || '75');
                    localStorage.setItem('theme', data.theme || 'light');
                    localStorage.setItem('accent_color', data.accent_color || '#007aff');
                } else {
                    throw new Error('Invalid or unrecognized backup file format.');
                }
                
                // *** CRITICAL STEP: Run migration on WHATEVER was imported ***
                // This ensures old v2 files (with 'attended:bool') are also migrated
                // This builds subjectsMaster for v1 files
                migrateOldData(); 
                    
                // Now save the migrated data from the global variables
                saveToLocal();

                showNotification('Data imported successfully. The app will now reload.', 'success');
                setTimeout(() => location.reload(), 1500);

            } catch (err) {
                console.error("Error importing data:", err);
                showNotification(`Failed to import data: ${err.message}`, 'error', null, 'Import Error');
                loadFromLocal(); // Reload from (now empty) local storage
            } finally {
                e.target.value = null; // Reset file input
            }
        };
        reader.readAsText(file);
    }, 'Confirm Import');
    
    e.target.value = null; // Reset file input
}


// --- Profile Management ---
function renderProfileManager() {
    const manager = document.getElementById('profile-manager');
    const select = document.getElementById('profile-select');
    if (!manager || !select) return;

    manager.style.display = 'block';
    select.innerHTML = '';
    
    const profileNames = Object.keys(profiles).sort();
    
    profileNames.forEach(name => {
        select.add(new Option(name, name, false, name === currentProfileId));
    });
}

function switchProfile(profileId) {
    if (!profiles[profileId]) return;
    saveToLocal();
    currentProfileId = profileId;
    
    timetable = profiles[currentProfileId].timetable || {};
    attendance = profiles[currentProfileId].attendance || [];
    monthlyHistory = profiles[currentProfileId].monthlyHistory || [];
    currentMonthName = profiles[currentProfileId].currentMonthName || null;
    holidays = profiles[currentProfileId].holidays || [];
    
    saveToLocal(); 
    
    createTimetableInputs();
    setupInitialUIState();
    renderSubjectMasterList();
    if (document.getElementById('results')?.style.display === 'block' || currentMonthName) {
         showResults();
    }
    showNotification(`Switched to profile: ${profileId}`, 'success');
}

async function createNewProfile() {
    const name = await showCustomPrompt("Enter a name for the new profile/semester:");
    if (!name) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    
    if (profiles[cleanName]) {
        showNotification(`Profile "${cleanName}" already exists.`, 'error');
        return;
    }
    
    saveToLocal(); 
    
    profiles[cleanName] = { timetable: {}, attendance: [], monthlyHistory: [], currentMonthName: null, holidays: [] };
    saveToLocal();
    switchProfile(cleanName);
    showNotification(`Created new profile: ${cleanName}`, 'success');
}

async function renameCurrentProfile() {
    const newName = await showCustomPrompt("Enter new name for current profile:", currentProfileId);
    if (!newName) return;
    const cleanName = newName.trim();
    if (!cleanName || cleanName === currentProfileId) return;
    
    if (profiles[cleanName]) {
         showNotification(`Profile "${cleanName}" already exists.`, 'error');
         return;
    }
    
    profiles[cleanName] = profiles[currentProfileId];
    delete profiles[currentProfileId];
    saveToLocal();
    switchProfile(cleanName);
    showNotification(`Profile renamed to: ${cleanName}`, 'success');
}

function deleteCurrentProfile() {
    if (Object.keys(profiles).length <= 1) {
        showNotification("You cannot delete your only profile. Create a new one first.", 'error');
        return;
    }
    
    showNotification(`Are you sure you want to delete profile "${currentProfileId}"? All data for this will be lost forever.`, 'confirm', () => {
        delete profiles[currentProfileId];
        currentProfileId = Object.keys(profiles)[0];
        switchProfile(currentProfileId);
        renderProfileManager();
    }, 'Confirm Delete');
}

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
    // Profile Forms
    document.getElementById('profile-select')?.addEventListener('change', (e) => switchProfile(e.target.value));
    document.getElementById('add-profile-btn')?.addEventListener('click', createNewProfile);
    document.getElementById('rename-profile-btn')?.addEventListener('click', renameCurrentProfile);
    document.getElementById('delete-profile-btn')?.addEventListener('click', deleteCurrentProfile);
    document.getElementById('add-holiday-btn')?.addEventListener('click', () => {
        addHolidayUI(document.getElementById('holidays-list'));
    });
    
    document.getElementById('edit-timetable-btn')?.addEventListener('click', () => {
        const setup = document.getElementById('timetable-setup');
        if (setup) setup.style.display = setup.style.display === 'none' ? 'block' : 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // Core Data & Share Listeners
    document.getElementById('export-data-btn')?.addEventListener('click', exportData);
    document.getElementById('import-file-input')?.addEventListener('change', importData);
    document.getElementById('export-report-btn')?.addEventListener('click', exportReportToCSV);
    
    document.getElementById('enable-reminders-btn')?.addEventListener('click', toggleReminders);

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

    // Holiday & Back Navigation
    document.getElementById('mark-holiday-btn')?.addEventListener('click', markDayAsHoliday);
    document.getElementById('back-to-timetable-from-prev')?.addEventListener('click', goBackToTimetable);
    document.getElementById('back-to-timetable-from-month')?.addEventListener('click', goBackToTimetable);

    // *** NEW EVENT LISTENER ***
    document.getElementById('view-date-btn')?.addEventListener('click', showAttendanceForDate);
    // *** END NEW LISTENER ***

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

    // Calendar Buttons
    document.getElementById('calendar-prev-month')?.addEventListener('click', () => {
        calendarView.setMonth(calendarView.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('calendar-next-month')?.addEventListener('click', () => {
        calendarView.setMonth(calendarView.getMonth() + 1);
        renderCalendar();
    });

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
     renderProfileManager();
     startReminderLoop(); // Check for set reminders

     const timetableSetup = document.getElementById('timetable-setup');
     const projectionsSection = document.getElementById('projections');
     if (!timetableSetup || !projectionsSection) return;

     // Set calendar view to current month or saved month
     if (currentMonthName) {
         // This is a bit tricky, as month name isn't a date
         // We'll just default to today's date for the calendar view
         calendarView = new Date();
     } else {
         calendarView = new Date();
     }

     // Check if timetable has *any* days defined with actual subjects
     const isTimetableSetup = Object.keys(timetable).length > 0 && 
                              Object.values(timetable).some(dayArray => Array.isArray(dayArray) && dayArray.length > 0);

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
         // Timetable not set up yet for this profile
         timetableSetup.style.display = 'block';
         
         // Explicitly hide all other dashboard sections belonging to an active profile
         const sectionsToHide = ['previous-attendance-setup', 'month-controls', 'attendance-mark', 'projections', 'results', 'insights-dashboard'];
         sectionsToHide.forEach(id => {
             const el = document.getElementById(id);
             if (el) el.style.display = 'none';
         });
     }
}