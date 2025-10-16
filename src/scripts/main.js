// This file contains the JavaScript code for the attendance calculator.

document.addEventListener('DOMContentLoaded', () => {
    const scheduleForm = document.getElementById('schedule-form');
    const attendanceForm = document.getElementById('attendance-form');
    const resultDiv = document.getElementById('result');

    scheduleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const subjects = Array.from(document.querySelectorAll('.subject-input')).map(input => input.value);
        localStorage.setItem('subjects', JSON.stringify(subjects));
        alert('Weekly schedule saved!');
    });

    attendanceForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const attendedClasses = parseInt(document.getElementById('attended-classes').value);
        const totalClasses = parseInt(document.getElementById('total-classes').value);
        const attendancePercentage = calculateAttendance(attendedClasses, totalClasses);
        displayResult(attendancePercentage);
    });

    function calculateAttendance(attended, total) {
        if (total === 0) return 0;
        return ((attended / total) * 100).toFixed(2);
    }

    function displayResult(percentage) {
        resultDiv.innerHTML = `Your attendance percentage is: ${percentage}%`;
    }

    function showResults() {
        document.getElementById('results').style.display = '';
        showAttendanceTable();
        showAllMonthsAttendance();
        showCumulativeAttendance();
        showTotalAttendancePerSubject();
    }

    function showTotalAttendancePercentage() {
        let container = document.getElementById('total-attendance-percentage');
        if (!container) {
            container = document.createElement('div');
            container.id = 'total-attendance-percentage';
            document.getElementById('results').appendChild(container);
        }

        // Aggregate all months + current month
        let attended = 0, total = 0;

        // Past months
        if (Array.isArray(monthlyHistory)) {
            monthlyHistory.forEach(monthEntry => {
                monthEntry.attendance.forEach(entry => {
                    entry.subjects.forEach(s => {
                        total += 1;
                        if (s.attended) attended += 1;
                    });
                });
            });
        }

        // Current month (if any)
        if (Array.isArray(attendance)) {
            attendance.forEach(entry => {
                entry.subjects.forEach(s => {
                    total += 1;
                    if (s.attended) attended += 1;
                });
            });
        }

        let percent = total ? ((attended / total) * 100).toFixed(2) : 'N/A';
        container.innerHTML = `<h3>Overall Attendance Percentage</h3>
            <p>${attended}/${total} (${percent}%)</p>`;
    }

    function showTotalAttendancePerSubject() {
        let container = document.getElementById('total-attendance');
        if (!container) {
            container = document.createElement('div');
            container.id = 'total-attendance';
            document.getElementById('results').appendChild(container);
        }

        // Aggregate all months + current month
        let subjectTotals = {};

        // Past months
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

        // Current month (if any)
        if (Array.isArray(attendance)) {
            attendance.forEach(entry => {
                entry.subjects.forEach(s => {
                    if (!subjectTotals[s.name]) subjectTotals[s.name] = {attended: 0, total: 0};
                    subjectTotals[s.name].total += 1;
                    if (s.attended) subjectTotals[s.name].attended += 1;
                });
            });
        }

        container.innerHTML = `<h3>Total Attendance</h3>`;
        if (Object.keys(subjectTotals).length === 0) {
            container.innerHTML += '<p>No attendance data available.</p>';
            return;
        }

        container.innerHTML += '<ul>';
        Object.keys(subjectTotals).forEach(subject => {
            const {attended, total} = subjectTotals[subject];
            const percent = total ? ((attended / total) * 100).toFixed(2) : 'N/A';
            container.innerHTML += `<li>${subject}: ${attended}/${total} (${percent}%)</li>`;
        });
        container.innerHTML += '</ul>';
    }

    function showCumulativeAttendance() {
        let container = document.getElementById('cumulative-attendance');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cumulative-attendance';
            document.getElementById('results').appendChild(container);
        }
        container.innerHTML = '<h3>Complete Attendance (All Months)</h3>';

        let subjectTotals = {};

        // Aggregate previous months
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

        // Aggregate current month
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
            container.innerHTML += '<p>No attendance data available.</p>';
            return;
        }

        container.innerHTML += '<ul>';
        Object.keys(subjectTotals).forEach(subject => {
            const {attended, total} = subjectTotals[subject];
            const percent = total ? ((attended / total) * 100).toFixed(2) : 'N/A';
            container.innerHTML += `<li>${subject}: ${attended}/${total} (${percent}%)</li>`;
        });
        container.innerHTML += '</ul>';
    }
});