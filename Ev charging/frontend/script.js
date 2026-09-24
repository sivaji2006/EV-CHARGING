/**
 * Smart EV Remote Charging & Auto Cut-Off System - Frontend Logic
 * Strictly Real Hardware Telemetry & Control Integration
 */

// ==============================================================================
// 1. CONFIGURATION & DOM REFERENCES
// ==============================================================================
const API_BASE_URL = window.location.origin.includes('5000')
    ? ''
    : 'http://127.0.0.1:5000';

const POLLING_INTERVAL_MS = 1500;
const GAUGE_CIRCUMFERENCE = 596.9; // 2 * PI * 95

// Header & Connection Elements
const serverBadge = document.getElementById('server-badge');
const serverBadgeText = document.getElementById('server-badge-text');
const esp32Badge = document.getElementById('esp32-badge');
const esp32BadgeText = document.getElementById('esp32-badge-text');

// Metric Status Cards
const metricVoltage = document.getElementById('metric-voltage');
const metricVoltageSub = document.getElementById('metric-voltage-sub');
const metricSoc = document.getElementById('metric-soc');
const metricSocSub = document.getElementById('metric-soc-sub');
const metricRelay = document.getElementById('metric-relay');
const metricRelaySub = document.getElementById('metric-relay-sub');
const metricCharging = document.getElementById('metric-charging');
const metricChargingSub = document.getElementById('metric-charging-sub');
const metricEsp32 = document.getElementById('metric-esp32');
const metricEsp32Ip = document.getElementById('metric-esp32-ip');

// Primary Gauge Elements
const gaugeProgress = document.getElementById('gauge-progress');
const gaugeSocVal = document.getElementById('gauge-soc-val');
const gaugeVoltageVal = document.getElementById('gauge-voltage-val');
const gaugeChargingIcon = document.getElementById('gauge-charging-icon');
const gaugeLiveBadge = document.getElementById('gauge-live-badge');
const gaugeLiveText = document.getElementById('gauge-live-text');
const gaugeStatusDesc = document.getElementById('gauge-status-desc');

// Charging Control Elements
const chargingStateBadge = document.getElementById('charging-state-badge');
const chargingStateLabel = document.getElementById('charging-state-label');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');

// Auto Cut-Off & Notification Banners
const cutoffBanner = document.getElementById('cutoff-banner');
const cutoffVoltageText = document.getElementById('cutoff-voltage-text');
const systemToast = document.getElementById('system-toast');
const toastMessage = document.getElementById('toast-message');

// Hardware Health & Activity Timeline
const healthEsp32 = document.getElementById('health-esp32');
const healthRelay = document.getElementById('health-relay');
const healthSensor = document.getElementById('health-sensor');
const healthBackend = document.getElementById('health-backend');
const activityTimeline = document.getElementById('activity-timeline');
const eventCount = document.getElementById('event-count');
const chartEmptyState = document.getElementById('chart-empty-state');

// Chart instance
let batteryChart = null;
let toastTimeout = null;
let lastRenderedEventTime = null;

// ==============================================================================
// 2. CHART.JS INITIALIZATION (REAL BATTERY MONITORING)
// ==============================================================================
function initChart() {
    const ctx = document.getElementById('batteryChart').getContext('2d');

    const gradientVoltage = ctx.createLinearGradient(0, 0, 0, 300);
    gradientVoltage.addColorStop(0, 'rgba(0, 210, 255, 0.28)');
    gradientVoltage.addColorStop(1, 'rgba(0, 210, 255, 0.0)');

    const gradientSoc = ctx.createLinearGradient(0, 0, 0, 300);
    gradientSoc.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
    gradientSoc.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    batteryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Battery Voltage (V)',
                    data: [],
                    borderColor: '#00d2ff',
                    backgroundColor: gradientVoltage,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#00d2ff',
                    yAxisID: 'yVoltage'
                },
                {
                    label: 'Estimated SOC (%)',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: gradientSoc,
                    borderWidth: 2,
                    borderDash: [4, 4],
                    fill: false,
                    tension: 0.35,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#10b981',
                    yAxisID: 'ySoc'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: 600 },
                        boxWidth: 14,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(14, 22, 38, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    titleFont: { family: "'Outfit', sans-serif", weight: 700 },
                    bodyFont: { family: "'JetBrains Mono', monospace" }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: {
                        color: '#64748b',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        maxRotation: 0
                    }
                },
                yVoltage: {
                    type: 'linear',
                    position: 'left',
                    min: 2.8,
                    max: 4.4,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#00d2ff',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        callback: (v) => v.toFixed(2) + 'V'
                    },
                    title: {
                        display: true,
                        text: 'Voltage (V)',
                        color: '#00d2ff',
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: 600 }
                    }
                },
                ySoc: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#10b981',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        callback: (v) => v + '%'
                    },
                    title: {
                        display: true,
                        text: 'Estimated SOC (%)',
                        color: '#10b981',
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: 600 }
                    }
                }
            }
        }
    });
}

function updateChart(voltage, soc) {
    if (voltage === null && soc === null) {
        chartEmptyState.classList.remove('hidden');
        return;
    }

    chartEmptyState.classList.add('hidden');
    const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const labels = batteryChart.data.labels;
    const vData = batteryChart.data.datasets[0].data;
    const sData = batteryChart.data.datasets[1].data;

    if (labels.length >= 20) {
        labels.shift();
        vData.shift();
        sData.shift();
    }

    labels.push(nowLabel);
    vData.push(voltage);
    sData.push(soc);
    batteryChart.update('none');
}

// ==============================================================================
// 3. REAL STATUS POLLING & UI RENDERING
// ==============================================================================
async function fetchStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/status`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const data = await response.json();

        // Update Backend Connection Badge
        serverBadge.className = 'connection-badge badge-online';
        serverBadgeText.textContent = 'Server Online';
        healthBackend.className = 'health-badge online';
        healthBackend.textContent = 'Online (Port 5000)';

        renderDashboard(data);
    } catch (error) {
        setOfflineState();
    }
}

function setOfflineState() {
    serverBadge.className = 'connection-badge badge-offline';
    serverBadgeText.textContent = 'Server Offline';
    healthBackend.className = 'health-badge offline';
    healthBackend.textContent = 'Offline';

    esp32Badge.className = 'connection-badge badge-offline';
    esp32BadgeText.textContent = 'ESP32 Offline';
    healthEsp32.className = 'health-badge offline';
    healthEsp32.textContent = 'Offline';

    metricEsp32.textContent = 'OFFLINE';
    metricEsp32.className = 'metric-status status-off';

    btnStart.disabled = true;
    btnStop.disabled = true;
}

function renderDashboard(data) {
    const isCharging = Boolean(data.charging_status);
    const relayOn = data.relay_state === 'ON';
    const esp32Connected = Boolean(data.esp32_connected);
    const voltage = data.battery_voltage !== null && data.battery_voltage !== undefined ? parseFloat(data.battery_voltage) : null;
    const soc = data.battery_soc !== null && data.battery_soc !== undefined ? parseFloat(data.battery_soc) : null;
    const autoCutoff = Boolean(data.auto_cutoff_triggered);
    const sensorActive = Boolean(data.sensor_active);

    // 1. ESP32 Real Hardware Connection Status
    if (esp32Connected) {
        esp32Badge.className = 'connection-badge badge-online';
        esp32BadgeText.textContent = 'ESP32 Connected';
        metricEsp32.textContent = 'CONNECTED';
        metricEsp32.className = 'metric-status status-on';
        healthEsp32.className = 'health-badge online';
        healthEsp32.textContent = 'Connected (HTTP)';
    } else {
        esp32Badge.className = 'connection-badge badge-offline';
        esp32BadgeText.textContent = 'ESP32 Offline';
        metricEsp32.textContent = 'OFFLINE';
        metricEsp32.className = 'metric-status status-off';
        healthEsp32.className = 'health-badge offline';
        healthEsp32.textContent = 'Offline (No response)';
    }
    metricEsp32Ip.textContent = `IP: ${data.esp32_ip || '192.168.1.100'}:80`;

    // 2. Voltage Card
    if (voltage !== null) {
        metricVoltage.textContent = voltage.toFixed(2);
        metricVoltageSub.textContent = `Live terminal voltage`;
        gaugeVoltageVal.textContent = voltage.toFixed(2);
    } else {
        metricVoltage.textContent = '--';
        metricVoltageSub.textContent = 'Waiting for sensor data';
        gaugeVoltageVal.textContent = '--';
    }

    // 3. Estimated SOC Card
    if (soc !== null) {
        metricSoc.textContent = soc.toFixed(1);
        metricSocSub.textContent = soc >= 100 ? 'Full Charge Reached' : 'Calibrated Li-ion curve';
        gaugeSocVal.textContent = soc.toFixed(0);
    } else {
        metricSoc.textContent = '--';
        metricSocSub.textContent = 'Waiting for live data';
        gaugeSocVal.textContent = '--';
    }

    // 4. Relay Status Card
    if (relayOn) {
        metricRelay.textContent = 'ON';
        metricRelay.className = 'metric-status status-on';
        metricRelaySub.textContent = 'GPIO 26 Active HIGH';
        healthRelay.textContent = 'HIGH (Energized)';
        healthRelay.className = 'health-badge on';
    } else {
        metricRelay.textContent = 'OFF';
        metricRelay.className = 'metric-status status-off';
        metricRelaySub.textContent = 'GPIO 26 LOW (Isolated)';
        healthRelay.textContent = 'LOW (Open/Isolated)';
        healthRelay.className = 'health-badge off';
    }

    // 5. Charging Status Card & Controls
    if (isCharging) {
        metricCharging.textContent = 'ACTIVE';
        metricCharging.className = 'metric-status status-active';
        metricChargingSub.textContent = '5V DC Power Delivery ON';

        chargingStateBadge.className = 'state-pill active';
        chargingStateLabel.textContent = 'Charging Active';

        gaugeChargingIcon.classList.add('active');

        btnStart.disabled = true;
        btnStop.disabled = false;
    } else {
        metricCharging.textContent = 'STOPPED';
        metricCharging.className = 'metric-status status-off';
        metricChargingSub.textContent = autoCutoff ? 'Auto Cut-Off Enforced' : 'Power delivery inactive';

        chargingStateBadge.className = 'state-pill stopped';
        chargingStateLabel.textContent = autoCutoff ? 'Cut-Off Triggered' : (esp32Connected ? 'Charging Stopped' : 'ESP32 Offline');

        gaugeChargingIcon.classList.remove('active');

        // Can only start if ESP32 is connected and battery is not already 100%
        btnStart.disabled = (!esp32Connected) || (soc !== null && soc >= 100);
        btnStop.disabled = true;
    }

    // 6. Primary SVG Radial Gauge
    renderRadialGauge(soc, voltage, isCharging);

    // 7. Sensor Health Status
    if (sensorActive && voltage !== null) {
        healthSensor.className = 'health-badge online';
        healthSensor.textContent = `Active (${voltage.toFixed(2)}V)`;
        gaugeLiveBadge.className = 'live-pill active';
        gaugeLiveText.textContent = 'Telemetry Live';
        gaugeStatusDesc.textContent = `Real-time ADC reading from GPIO 34 (${voltage.toFixed(2)}V)`;
        gaugeStatusDesc.className = 'status-active-text';
    } else if (voltage !== null) {
        healthSensor.className = 'health-badge waiting';
        healthSensor.textContent = `Idle (${voltage.toFixed(2)}V)`;
        gaugeLiveBadge.className = 'live-pill idle';
        gaugeLiveText.textContent = 'Telemetry Idle';
        gaugeStatusDesc.textContent = `Last recorded voltage: ${voltage.toFixed(2)}V`;
        gaugeStatusDesc.className = 'status-waiting-text';
    } else {
        healthSensor.className = 'health-badge waiting';
        healthSensor.textContent = 'Awaiting Data';
        gaugeLiveBadge.className = 'live-pill idle';
        gaugeLiveText.textContent = 'Awaiting Data';
        gaugeStatusDesc.textContent = 'Waiting for live sensor data from ESP32 ADC (GPIO 34)';
        gaugeStatusDesc.className = 'status-waiting-text';
    }

    // 8. Real Auto Cut-Off Banner
    if (autoCutoff) {
        cutoffBanner.classList.remove('hidden');
        cutoffVoltageText.textContent = voltage ? `${voltage.toFixed(2)}V` : '4.20V';
    } else {
        cutoffBanner.classList.add('hidden');
    }

    // 9. Real Telemetry Graph Update
    if (voltage !== null || soc !== null) {
        const currentPoints = batteryChart.data.datasets[0].data;
        const lastPoint = currentPoints.length > 0 ? currentPoints[currentPoints.length - 1] : null;
        if (lastPoint !== voltage || currentPoints.length === 0) {
            updateChart(voltage, soc);
        }
    } else {
        chartEmptyState.classList.remove('hidden');
    }

    // 10. Real Chronological Events
    if (data.events && Array.isArray(data.events)) {
        renderEventTimeline(data.events);
    }
}

/**
 * Updates the SVG circular progress arc
 */
function renderRadialGauge(soc, voltage, isCharging) {
    if (soc === null || soc === undefined) {
        gaugeProgress.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
        gaugeProgress.className = 'gauge-progress';
        return;
    }

    const clampedSoc = Math.max(0, Math.min(100, soc));
    const offset = GAUGE_CIRCUMFERENCE - (clampedSoc / 100) * GAUGE_CIRCUMFERENCE;
    gaugeProgress.style.strokeDashoffset = offset;

    if (clampedSoc >= 100) {
        gaugeProgress.className = 'gauge-progress full';
    } else if (clampedSoc <= 20) {
        gaugeProgress.className = 'gauge-progress low';
    } else {
        gaugeProgress.className = 'gauge-progress';
    }
}

/**
 * Renders real chronological event log from backend
 */
function renderEventTimeline(events) {
    eventCount.textContent = `${events.length} Event${events.length === 1 ? '' : 's'}`;
    
    if (events.length === 0) {
        activityTimeline.innerHTML = '<div class="empty-timeline-text">No recent activity</div>';
        return;
    }

    const latestEventTime = events[0].time;
    if (latestEventTime === lastRenderedEventTime && activityTimeline.children.length === events.length) {
        return;
    }
    lastRenderedEventTime = latestEventTime;

    let html = '';
    events.forEach(evt => {
        const typeClass = evt.type || 'info';
        html += `
            <div class="timeline-item ${typeClass}">
                <span class="timeline-time">${escapeHtml(evt.time)}</span>
                <span class="timeline-msg">${escapeHtml(evt.message)}</span>
            </div>
        `;
    });

    activityTimeline.innerHTML = html;
}

// ==============================================================================
// 4. CHARGING CONTROL ACTIONS (START / STOP)
// ==============================================================================
async function startCharging() {
    btnStart.disabled = true;
    showToast('Sending START command to ESP32 Relay...', 'info');

    try {
        const response = await fetch(`${API_BASE_URL}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (response.ok) {
            showToast(data.message || 'Charging Started Successfully', 'success');
        } else {
            showToast(data.message || 'Cannot start charging: Hardware unreachable', 'warning');
        }
    } catch (error) {
        showToast('Network error: Could not reach Flask backend', 'warning');
    } finally {
        setTimeout(fetchStatus, 300);
    }
}

async function stopCharging() {
    btnStop.disabled = true;
    showToast('Sending STOP command to ESP32 Relay...', 'info');

    try {
        const response = await fetch(`${API_BASE_URL}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (response.ok) {
            showToast(data.message || 'Charging Stopped Successfully', 'success');
        } else {
            showToast(data.message || 'Failed to stop charging', 'warning');
        }
    } catch (error) {
        showToast('Network error: Could not reach Flask backend', 'warning');
    } finally {
        setTimeout(fetchStatus, 300);
    }
}

async function dismissCutoffAlert() {
    cutoffBanner.classList.add('hidden');
    try {
        await fetch(`${API_BASE_URL}/reset_cutoff`, { method: 'POST' });
    } catch (e) {
        console.warn('Could not reset cutoff on server', e);
    }
}

// ==============================================================================
// 5. TOAST NOTIFICATIONS & TAB NAVIGATION
// ==============================================================================
function showToast(message, type = 'info') {
    toastMessage.textContent = message;
    systemToast.classList.remove('hidden');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        systemToast.classList.add('hidden');
    }, 3500);
}

function switchTab(tabId) {
    const tabDashboard = document.getElementById('view-dashboard');
    const tabOverview = document.getElementById('view-overview');
    const btnDashboard = document.getElementById('tab-btn-dashboard');
    const btnOverview = document.getElementById('tab-btn-overview');

    if (tabId === 'dashboard') {
        tabDashboard.classList.add('active');
        tabOverview.classList.remove('active');
        btnDashboard.classList.add('active');
        btnOverview.classList.remove('active');
    } else {
        tabOverview.classList.add('active');
        tabDashboard.classList.remove('active');
        btnOverview.classList.add('active');
        btnDashboard.classList.remove('active');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==============================================================================
// 6. INITIALIZATION ON PAGE LOAD
// ==============================================================================
window.addEventListener('DOMContentLoaded', () => {
    initChart();
    fetchStatus();
    setInterval(fetchStatus, POLLING_INTERVAL_MS);
});
