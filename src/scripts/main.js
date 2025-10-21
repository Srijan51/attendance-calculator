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
    showMonthControls();
}

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
                label.innerHTML = `<input type="checkbox" name="subject" value="${subject}"> ${subject}`;
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
        alert('Please start a new month first.');
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
                ${entry.subjects.map(s =>
                    `<span class="subject-cell">${s.name} ${s.attended ? '✅' : '❌'}</span>`
                ).join('')}
            </td>
        </tr>`;
    });
    table += '</tbody></table>';
    container.innerHTML += table;
}

function showAllMonthsAttendance() {
    const container = document.getElementById('all-months-attendance');
    container.innerHTML = '<h3>Previous Months</h3>';
    if (!monthlyHistory.length) {
        container.innerHTML += '<p>No previous months stored.</p>';
        return;
    }
    monthlyHistory.forEach(monthEntry => {
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

function removeAllRecords() {
    if (confirm('Are you sure you want to remove all records? This action cannot be undone.')) {
        localStorage.clear();
        timetable = {};
        attendance = [];
        monthlyHistory = [];
        currentMonthName = null;
        location.reload();
    }
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
        alert('Please fill in both date and subject name.');
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
                alert('Error: Week and Day are required for a new date.');
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
            alert(`Subject "${subject}" added for ${date} (Attended: ${attended ? 'Yes' : 'No'}).`);
        } else {
            alert('Subject already exists for this date.');
        }
        
    } else if (action === 'remove') {
        if (!entry) {
            alert('No attendance entry found for this date.');
            return;
        }
        
        const idx = entry.subjects.findIndex(s => s.name === subject);
        if (idx !== -1) {
            entry.subjects.splice(idx, 1);
            alert(`Subject "${subject}" removed for ${date}.`);
        } else {
            alert('Subject not found for this date.');
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
    
    // NEW Modify Form Listeners
    document.getElementById('add-subject-btn-show').addEventListener('click', () => toggleModifyForm(true, 'add'));
    document.getElementById('remove-subject-btn-show').addEventListener('click', () => toggleModifyForm(true, 'remove'));
    document.getElementById('cancel-modify').addEventListener('click', () => toggleModifyForm(false));
    document.getElementById('modify-subject-form').addEventListener('submit', handleModifySubject);
    document.getElementById('modify-date').addEventListener('change', checkNewDate);

    
    // This logic runs on page load
    if (Object.keys(timetable).length) {
        document.getElementById('timetable-setup').style.display = 'none';
        showMonthControls(); 
        if (currentMonthName) {
            document.getElementById('attendance-mark').style.display = 'block';
            showAttendanceForm();
            showResults(); 
        }
    }
});