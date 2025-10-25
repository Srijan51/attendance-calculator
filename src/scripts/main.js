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
        timetable[day] = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
    });
    saveToLocal();
    document.getElementById('timetable-setup').style.display = 'none';

    // MODIFIED: Show previous attendance form instead of month controls
    createPreviousAttendanceInputs();
    // showMonthControls(); // This is now called by the previous attendance form handlers
}

// --- NEW FEATURE: Previous Attendance ---

/**
 * Helper function to get a unique list of all subjects from the timetable
 */
function getUniqueSubjects() {
    const allSubjects = Object.values(timetable).flat(); // Get all subjects from all days
    return [...new Set(allSubjects)]; // Return a unique set
}

/**
 * Creates the input fields for setting previous attendance data.
 */
function createPreviousAttendanceInputs() {
    const container = document.getElementById('previous-subjects-container');
    container.innerHTML = ''; // Clear previous
    const subjects = getUniqueSubjects();

    if (subjects.length === 0) {
        // No subjects in timetable, just skip this step
        showMonthControls();
        return;
    }

    subjects.forEach(subject => {
        const div = document.createElement('div');
        div.className = 'previous-subject-entry';
        
        // Simpler layout: Label, Input, % sign
        div.innerHTML = `
            <label for="prev-percent-${subject}">${subject}</label>
            <div class="input-wrapper">
                <input type="number" id="prev-percent-${subject}" min="0" max="100" step="0.01" value="75.00" placeholder="e.g. 75">
                <span class="percent-sign">%</span>
            </div>
        `;
        container.appendChild(div);
    });

    document.getElementById('previous-attendance-setup').style.display = 'block';
}

/**
 * Saves the previous attendance data to monthlyHistory.
 * We assume a baseline of 100 classes for this calculation.
 */
function savePreviousAttendance(e) {
    e.preventDefault();
    const subjects = getUniqueSubjects();
    let previousSubjects = [];
    let hasErrors = false;
    const BASE_TOTAL = 100; // Assume 100 classes as a baseline

    for (const subject of subjects) {
        const percentInput = document.getElementById(`prev-percent-${subject}`);
        const percentage = parseFloat(percentInput.value) || 0;

        if (percentage < 0 || percentage > 100) {
            showNotification(`For ${subject}, percentage must be between 0 and 100.`, 'error', null, 'Input Error');
            percentInput.focus();
            hasErrors = true;
            break; // Stop processing
        }

        // Calculate attended/missed based on the 100 baseline
        const attended = Math.round(BASE_TOTAL * (percentage / 100));
        const missed = BASE_TOTAL - attended;

        if (attended > 0) {
            // Add 'attended' entries
            for (let i = 0; i < attended; i++) {
                previousSubjects.push({ name: subject, attended: true });
            }
        }
        if (missed > 0) {
            // Add 'missed' entries
            for (let i = 0; i < missed; i++) {
                previousSubjects.push({ name: subject, attended: false });
            }
        }
    }

    if (hasErrors) return; // Don't save if there was an error

    if (previousSubjects.length > 0) {
        // Remove any existing "Previous Data" to avoid duplicates
        monthlyHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data");

        // Create a single dummy attendance entry holding all subjects
        const previousEntry = {
            week: 0,
            day: 'N/A',
            date: 'N/A',
            month: 'Previous Data',
            subjects: previousSubjects
        };

        const monthEntry = {
            monthName: "Previous Data",
            attendance: [previousEntry]
        };

        monthlyHistory.push(monthEntry);
        saveToLocal();
    }

    document.getElementById('previous-attendance-setup').style.display = 'none';
    showMonthControls();
    showNotification('Previous attendance data saved successfully.', 'success');
}

/**
 * Skips the previous attendance step.
 */
function skipPreviousAttendance() {
    document.getElementById('previous-attendance-setup').style.display = 'none';
    showMonthControls();
}

// --- END NEW FEATURE ---


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
    const selectorsDiv = document.getElementById('week-day-selectors');
    selectorsDiv.innerHTML = '';

    const weekLabel = document.createElement('label');
    weekLabel.setAttribute('for', 'attendance-week-select');
    weekLabel.textContent = 'Select Week: ';
    const weekSelect = document.createElement('select');
    weekSelect.id = 'attendance-week-select';
    for (let w = 1; w <= WEEKS; w++) {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = `Week ${w}`;
        weekSelect.appendChild(opt);
    }

    const dayLabel = document.createElement('label');
    dayLabel.setAttribute('for', 'attendance-day-select');
    dayLabel.textContent = ' Select Day: ';
    const daySelect = document.createElement('select');
    daySelect.id = 'attendance-day-select';
    DAYS.forEach(day => {
        const opt = document.createElement('option');
        opt.value = day;
        opt.textContent = day;
        daySelect.appendChild(opt);
    });

    selectorsDiv.appendChild(weekLabel);
    selectorsDiv.appendChild(weekSelect);
    selectorsDiv.appendChild(dayLabel);
    selectorsDiv.appendChild(daySelect);

    function renderSubjects() {
        const todayDiv = document.getElementById('today-classes');
        todayDiv.innerHTML = '';
        const day = daySelect.value;
        
        const dateLabel = document.createElement('label');
        dateLabel.setAttribute('for', 'attendance-date');
        dateLabel.textContent = 'Date: ';
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.id = 'attendance-date';

        todayDiv.appendChild(dateLabel);
        todayDiv.appendChild(dateInput);
        
        todayDiv.innerHTML += `<h3>${day}</h3>`;
        const subjects = timetable[day] || [];
        if (!subjects.length) {
            todayDiv.innerHTML += '<p>No classes scheduled.</p>';
        } else {
            subjects.forEach(subject => {
                const label = document.createElement('label');
                // We use the <label> as the container
                label.innerHTML = `<input type="checkbox" name="subject" value="${subject}"> <span>${subject}</span>`;
                todayDiv.appendChild(label);
            });
        }
    }

    weekSelect.addEventListener('change', renderSubjects);
    daySelect.addEventListener('change', renderSubjects);

    renderSubjects();
}

function submitAttendance(e) {
    e.preventDefault();
    if (!currentMonthName) {
        // MODIFIED: Replaced alert()
        showNotification('Please start a new month first.', 'info');
        return;
    }
    const week = parseInt(document.getElementById('attendance-week-select').value);
    const day = document.getElementById('attendance-day-select').value;
    const date = document.getElementById('attendance-date').value;
    const subjects = timetable[day] || [];
    const attended = Array.from(document.querySelectorAll('input[name="subject"]:checked')).map(cb => cb.value);

    attendance = attendance.filter(entry => !(entry.week === week && entry.day === day));

    attendance.push({
        week,
        day,
        date,
        month: currentMonthName,
        subjects: subjects.map(name => ({
            name,
            attended: attended.includes(name)
        }))
    });

    saveToLocal();
    showResults();
}

function showResults() {
    document.getElementById('results').style.display = 'block'; 
    showAttendanceTable();
    showAllMonthsAttendance();
    showCompleteAttendance(); 
}

function showAttendanceTable() {
    const container = document.getElementById('attendance-table-container');
    container.innerHTML = '<h3>Current Month Attendance</h3>';
    let table = `<table class="attendance-table">
        <thead>
            <tr>
                <th>Week</th>
                <th>Date</th>
                <th>Day</th>
                <th>Subjects</th>
            </tr>
        </thead>
        <tbody>
    `;
    const sorted = [...attendance].sort((a, b) => {
        if (a.week !== b.week) return a.week - b.week;
        return DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    });
    sorted.forEach(entry => {
        table += `<tr>
            <td>${entry.week}</td>
            <td>${entry.date || ''}</td>
            <td>${entry.day}</td>
            <td>
                ${entry.subjects.map(s => {
                    // STYLISH: Added dynamic classes for attended/missed
                    const cellClass = s.attended ? 'subject-cell-attended' : 'subject-cell-missed';
                    const icon = s.attended ? '✅' : '❌';
                    return `<span class="subject-cell ${cellClass}">${s.name} ${icon}</span>`;
                }).join('')}
            </td>
        </tr>`;
    });
    table += '</tbody></table>';
    container.innerHTML += table;
}

function showAllMonthsAttendance() {
    const container = document.getElementById('all-months-attendance');
    container.innerHTML = '<h3>Previous Months</h3>';
    
    // MODIFIED: Filter out the "Previous Data" entry from this view
    const visibleHistory = monthlyHistory.filter(m => m.monthName !== "Previous Data");

    if (!visibleHistory.length) {
        container.innerHTML += '<p>No previous months stored.</p>';
        return;
    }
    
    visibleHistory.forEach(monthEntry => {
        container.innerHTML += `<h4>${monthEntry.monthName}</h4>`;
        let subjectTotals = {};
        monthEntry.attendance.forEach(entry => {
            entry.subjects.forEach(s => {
                if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0};
                subjectTotals[s.name].total += 1;
                if (s.attended) subjectTotals[s.name].attended += 1;
            });
        });
        container.innerHTML += '<ul>';
        Object.keys(subjectTotals).forEach(subject => {
            const {attended, total} = subjectTotals[subject];
            const percent = total ? ((attended / total) * 100).toFixed(2) : 'N/A';
            container.innerHTML += `<li>${subject}: ${attended}/${total} (${percent}%)</li>`;
        });
        container.innerHTML += '</ul>';
    });
}

function showCompleteAttendance() {
    const container = document.getElementById('complete-attendance');
    const tableDiv = document.getElementById('complete-attendance-table');
    container.style.display = 'block'; 
    tableDiv.innerHTML = '';

    let subjectTotals = {};

    // This logic is unchanged, as it will
    // automatically pick up the "Previous Data"
    // from monthlyHistory.
    if (Array.isArray(monthlyHistory)) {
        monthlyHistory.forEach(monthEntry => {
            monthEntry.attendance.forEach(entry => {
                entry.subjects.forEach(s => {
                    if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0};
                    subjectTotals[s.name].total += 1;
                    if (s.attended) subjectTotals[s.name].attended += 1;
                });
            });
        });
    }

    if (Array.isArray(attendance)) {
        attendance.forEach(entry => {
            entry.subjects.forEach(s => {
                if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0};
                subjectTotals[s.name].total += 1;
                if (s.attended) subjectTotals[s.name].attended += 1;
            });
        });
    }

    if (Object.keys(subjectTotals).length === 0) {
        tableDiv.innerHTML = '<p>No attendance data available.</p>';
        return;
    }

    let tableHTML = `<table class="attendance-table">
        <thead><tr><th>Subject</th><th>Attended</th><th>Total</th><th>Percentage</th></tr></thead><tbody>`;
    Object.keys(subjectTotals).forEach(subject => {
        const {attended, total} = subjectTotals[subject];
        const percent = total ? ((attended / total) * 100).toFixed(2) : 'N/A';
        tableHTML += `<tr><td>${subject}</td><td>${attended}</td><td>${total}</td><td>${percent}%</td></tr>`;
    });
    tableHTML += '</tbody></table>';

    tableDiv.innerHTML = tableHTML;
}

// --- UPDATED: Custom Notification Logic ---

// Store the callback for the confirm action
let notificationConfirmCallback = null;

/**
 * Shows a custom notification or confirmation.
 * @param {string} message The message to display.
 * @param {'info' | 'success' | 'error' | 'confirm'} type The type of notification.
 * @param {function | null} callback The function to run if 'confirm' is pressed.
 * @param {string} title Optional custom title.
 */
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
    iconEl.className = 'notification-icon'; // Reset icon class

    // Hide all buttons initially
    okBtn.style.display = 'none';
    confirmBtn.style.display = 'none';
    cancelBtn.style.display = 'none';

    switch (type) {
        case 'confirm':
            titleEl.textContent = title || 'Are you sure?';
            iconEl.innerHTML = '❓';
            iconEl.classList.add('notification-icon-confirm');
            confirmBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
            break;
        case 'success':
            titleEl.textContent = title || 'Success';
            iconEl.innerHTML = '✅';
            iconEl.classList.add('notification-icon-success');
            okBtn.style.display = 'inline-block';
            break;
        case 'error':
            titleEl.textContent = title || 'Error';
            iconEl.innerHTML = '❌';
            iconEl.classList.add('notification-icon-error');
            okBtn.style.display = 'inline-block';
            break;
        case 'info':
        default:
            titleEl.textContent = title || 'Notification';
            iconEl.innerHTML = 'ℹ️';
            iconEl.classList.add('notification-icon-info');
            okBtn.style.display = 'inline-block';
            break;
    }

    overlay.classList.remove('hidden', 'is-hiding'); // Show modal
}

/**
 * Hides the custom notification with animation.
 */
function hideNotification() {
    const overlay = document.getElementById('custom-notification-overlay');
    overlay.classList.add('is-hiding'); // Add class to trigger exit animation

    // Wait for animation to finish, then hide
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.classList.remove('is-hiding');
        notificationConfirmCallback = null;
    }, 300); // Must match the CSS transition duration
}

/**
 * Sets up the event listeners for the custom notification buttons.
 */
function setupNotificationListeners() {
    document.getElementById('custom-notification-ok').addEventListener('click', hideNotification);
    document.getElementById('custom-notification-cancel').addEventListener('click', hideNotification);
    document.getElementById('custom-notification-confirm').addEventListener('click', () => {
        if (typeof notificationConfirmCallback === 'function') {
            notificationConfirmCallback();
        }
        hideNotification();
    });
}

// --- End Custom Notification Logic ---


function removeAllRecords() {
    // MODIFIED: Replaced confirm() with new notification
    showNotification(
        'Are you sure you want to remove all records? This action cannot be undone.',
        'confirm',
        () => {
            // This is the code that runs on confirm
            localStorage.clear();
            timetable = {};
            attendance = [];
            monthlyHistory = [];
            currentMonthName = null;
            location.reload();
        }
    );
}

// --- EFFICIENT ADD/REMOVE LOGIC ---
function toggleModifyForm(show = false, mode = 'add') {
    const form = document.getElementById('modify-subject-form');
    const buttons = document.getElementById('modify-buttons-container');
    const title = document.getElementById('modify-form-title');
    const action = document.getElementById('modify-action');
    const newDateFields = document.getElementById('new-date-fields');
    const attendedWrapper = document.getElementById('modify-attended-wrapper'); // Get the wrapper

    if (show) {
        title.textContent = mode === 'add' ? 'Add Subject' : 'Remove Subject';
        action.value = mode;
        form.classList.remove('hidden');
        buttons.classList.add('hidden');
        
        // Reset fields
        document.getElementById('modify-date').value = '';
        document.getElementById('modify-subject').value = '';
        document.getElementById('modify-attended').checked = false; // Reset checkbox
        newDateFields.classList.add('hidden');

        // Show/hide attended checkbox based on mode
        if (mode === 'add') {
            attendedWrapper.classList.remove('hidden');
        } else {
            attendedWrapper.classList.add('hidden');
        }
    } else {
        form.classList.add('hidden');
        buttons.classList.remove('hidden');
        attendedWrapper.classList.add('hidden'); // Always hide when form closes
    }
}

function handleModifySubject(e) {
    e.preventDefault();
    
    const action = document.getElementById('modify-action').value;
    const date = document.getElementById('modify-date').value;
    const subject = document.getElementById('modify-subject').value;
    
    if (!date || !subject) {
        // MODIFIED: Replaced alert()
        showNotification('Please fill in both date and subject name.', 'error', null, 'Missing Information');
        return;
    }
    
    let entry = attendance.find(e => e.date === date);
    
    if (action === 'add') {
        const attended = document.getElementById('modify-attended').checked; // Get checkbox value
        
        if (!entry) {
            // Create new entry
            const week = parseInt(document.getElementById('modify-week').value);
            const day = document.getElementById('modify-day').value;
            
            if (!week || !day) {
                // MODIFIED: Replaced alert()
                showNotification('Error: Week and Day are required for a new date.', 'error');
                return;
            }
            
            entry = {
                week,
                day,
                date,
                month: currentMonthName,
                subjects: []
            };
            attendance.push(entry);
        }
        
        // Add subject if it doesn't exist
        if (!entry.subjects.some(s => s.name === subject)) {
            entry.subjects.push({ name: subject, attended: attended }); // Use the checkbox value
            // MODIFIED: Replaced alert()
            showNotification(`Subject "${subject}" added for ${date} (Attended: ${attended ? 'Yes' : 'No'}).`, 'success');
        } else {
            // MODIFIED: Replaced alert()
            showNotification('Subject already exists for this date.', 'error');
        }
        
    } else if (action === 'remove') {
        if (!entry) {
            // MODIFIED: Replaced alert()
            showNotification('No attendance entry found for this date.', 'error');
            return;
        }
        
        const idx = entry.subjects.findIndex(s => s.name === subject);
        if (idx !== -1) {
            entry.subjects.splice(idx, 1);
            // MODIFIED: Replaced alert()
            showNotification(`Subject "${subject}" removed for ${date}.`, 'success');
        } else {
            // MODIFIED: Replaced alert()
            showNotification('Subject not found for this date.', 'error');
        }
    }
    
    saveToLocal();
    showResults();
    toggleModifyForm(false); // Hide form after submit
}

function checkNewDate(e) {
    const date = e.target.value;
    if (!date) return;
    
    const entry = attendance.find(e => e.date === date);
    const newDateFields = document.getElementById('new-date-fields');
    
    // Only show Week/Day fields if it's an 'add' action AND the date is new
    if (document.getElementById('modify-action').value === 'add' && !entry) {
        newDateFields.classList.remove('hidden');
        
        // Auto-detect day of the week
        // Note: new Date(dateString) can be off by one day due to timezone.
        // Using split '-' ensures it's treated as local time.
        const dateParts = date.split('-');
        const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        const dayName = DAYS_OF_WEEK[localDate.getDay()];
        
        document.getElementById('modify-day').value = dayName;
    } else {
        newDateFields.classList.add('hidden');
    }
}

// --- END NEW LOGIC ---


// Add event listeners after DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
    loadFromLocal();
    createTimetableInputs();
    
    // Core Listeners
    document.getElementById('timetable-form').addEventListener('submit', saveTimetable);
    document.getElementById('attendance-form').addEventListener('submit', submitAttendance);
    document.getElementById('remove-all').addEventListener('click', removeAllRecords);
    
    // --- START NEW LISTENERS ---
    document.getElementById('previous-attendance-form').addEventListener('submit', savePreviousAttendance);
    document.getElementById('skip-previous-btn').addEventListener('click', skipPreviousAttendance);
    // --- END NEW LISTENERS ---
    
    // NEW Modify Form Listeners
    document.getElementById('add-subject-btn-show').addEventListener('click', () => toggleModifyForm(true, 'add'));
    document.getElementById('remove-subject-btn-show').addEventListener('click', () => toggleModifyForm(true, 'remove'));
    document.getElementById('cancel-modify').addEventListener('click', () => toggleModifyForm(false));
    document.getElementById('modify-subject-form').addEventListener('submit', handleModifySubject);
    document.getElementById('modify-date').addEventListener('change', checkNewDate);

    // NEW: Add listener for custom notification
    setupNotificationListeners();
    
    // This logic runs on page load
    if (Object.keys(timetable).length) {
        document.getElementById('timetable-setup').style.display = 'none';

        // MODIFIED: Check if "Previous Data" has already been entered or skipped.
        const hasPreviousData = monthlyHistory.some(m => m.monthName === "Previous Data");

        if (!currentMonthName && !hasPreviousData) {
            // User saved timetable but hasn't entered/skipped previous data
            createPreviousAttendanceInputs();
        } else {
            // User has already set up everything, show normal controls
            showMonthControls(); 
            if (currentMonthName) {
                document.getElementById('attendance-mark').style.display = 'block';
                showAttendanceForm();
                showResults(); 
            }
        }
    }
});