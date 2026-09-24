"""
Smart EV Remote Charging & Auto Cut-Off System
Flask Backend API with Real ESP32 Hardware Integration & Telemetry State Management
"""

import os
import time
from datetime import datetime
import threading
import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ==============================================================================
# CONFIGURATION PARAMETERS (Edit your ESP32 IP Address here)
# ==============================================================================
ESP32_IP = "192.168.1.100"      # Replace with actual IP assigned to ESP32
ESP32_PORT = 80                 # ESP32 Web Server HTTP Port
CUTOFF_VOLTAGE_THRESHOLD = 4.20 # Full-charge cutoff voltage for 18650 Li-ion cell (V)
CUTOFF_SOC_THRESHOLD = 100.0    # Full-charge cutoff SOC (%)
HEARTBEAT_INTERVAL = 3.0        # Seconds between background ESP32 health checks

# ==============================================================================
# GLOBAL SYSTEM STATE (Strictly Real Hardware Data Only)
# ==============================================================================
charging_status = False          # True = Verified Charging Active, False = Charging Stopped
battery_voltage = None           # Real measured voltage (V), None if no data
battery_soc = None               # Estimated SOC percentage (%), None if no data
relay_state = "OFF"              # "ON", "OFF", or "OFFLINE"
esp32_connected = False          # Status of real HTTP link with ESP32
auto_cutoff_triggered = False    # True if real auto cut-off occurred
last_telemetry_time = None       # Timestamp of last received sensor data
system_message = "System initialized. Waiting for live hardware data."

# Chronological event log (stores strictly real system actions and telemetry)
event_log = []
MAX_EVENT_LOG_SIZE = 25

# Lock to ensure thread-safe state modification
state_lock = threading.Lock()

# Define frontend path for web interface serving
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
CORS(app)


# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================
def log_event(message, event_type="info"):
    """Appends a real system event with timestamp to the chronological activity log."""
    global event_log
    now = datetime.now().strftime("%I:%M:%S %p")
    event_entry = {
        "time": now,
        "message": message,
        "type": event_type,
        "timestamp": time.time()
    }
    event_log.insert(0, event_entry)
    if len(event_log) > MAX_EVENT_LOG_SIZE:
        event_log.pop()
    print(f"[{now}] [{event_type.upper()}] {message}")


def calculate_soc_from_voltage(voltage):
    """
    Estimates 18650 Li-ion single-cell State of Charge (SOC) from real measured terminal voltage.
    Typical 18650 curve:
      <= 3.00V -> 0%
      3.60V    -> 20%
      3.70V    -> 45%
      3.85V    -> 70%
      4.00V    -> 85%
      >= 4.20V -> 100%
    """
    if voltage is None:
        return None
    
    v = float(voltage)
    if v <= 3.00:
        return 0.0
    elif v >= 4.20:
        return 100.0
    
    points = [
        (3.00, 0.0),
        (3.40, 10.0),
        (3.60, 20.0),
        (3.70, 45.0),
        (3.85, 70.0),
        (4.00, 85.0),
        (4.15, 95.0),
        (4.20, 100.0)
    ]
    
    for i in range(len(points) - 1):
        v1, s1 = points[i]
        v2, s2 = points[i + 1]
        if v1 <= v <= v2:
            return round(s1 + ((v - v1) / (v2 - v1)) * (s2 - s1), 1)
            
    return 100.0


# ==============================================================================
# ESP32 HARDWARE COMMUNICATION & HEARTBEAT
# ==============================================================================
def send_esp32_command_sync(command):
    """
    Sends synchronous HTTP REST command to ESP32.
    Returns (success: bool, response_text: str).
    """
    global esp32_connected
    url = f"http://{ESP32_IP}:{ESP32_PORT}/{command}"
    try:
        response = requests.get(url, timeout=2.0)
        if response.status_code == 200:
            esp32_connected = True
            return True, response.text.strip()
        else:
            esp32_connected = False
            return False, f"HTTP {response.status_code}"
    except Exception as e:
        esp32_connected = False
        return False, str(e)


def esp32_heartbeat_worker():
    """
    Background worker that queries ESP32 /status every HEARTBEAT_INTERVAL seconds.
    Syncs actual relay and hardware connection status.
    """
    global esp32_connected, relay_state, battery_voltage, battery_soc, charging_status, last_telemetry_time
    
    while True:
        time.sleep(HEARTBEAT_INTERVAL)
        url = f"http://{ESP32_IP}:{ESP32_PORT}/status"
        try:
            response = requests.get(url, timeout=1.5)
            if response.status_code == 200:
                data = response.json()
                with state_lock:
                    prev_connected = esp32_connected
                    esp32_connected = True
                    hw_relay = data.get("state", "OFF")
                    relay_state = hw_relay
                    charging_status = (hw_relay == "ON")
                    
                    # If ESP32 returned live ADC voltage reading
                    if "voltage" in data and data["voltage"] is not None:
                        measured_v = round(float(data["voltage"]), 2)
                        if measured_v > 0.1:  # Non-zero reading
                            battery_voltage = measured_v
                            battery_soc = calculate_soc_from_voltage(battery_voltage)
                            last_telemetry_time = time.time()
                    
                    if not prev_connected:
                        log_event(f"ESP32 hardware connected at {ESP32_IP}", "info")
            else:
                with state_lock:
                    if esp32_connected:
                        log_event(f"ESP32 link lost (HTTP {response.status_code})", "warning")
                    esp32_connected = False
        except Exception:
            with state_lock:
                if esp32_connected:
                    log_event(f"ESP32 hardware disconnected / offline", "warning")
                esp32_connected = False


# Launch background ESP32 health check thread
threading.Thread(target=esp32_heartbeat_worker, daemon=True).start()


# ==============================================================================
# REST API ENDPOINTS
# ==============================================================================

@app.route('/')
def serve_index():
    """Serves the web dashboard interface."""
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """Serves static files (style.css, script.js)."""
    return send_from_directory(FRONTEND_DIR, filename)


@app.route('/start', methods=['GET', 'POST'])
def start_charging():
    """
    Endpoint: /start
    Action: Requests ESP32 to turn Relay ON.
    Only updates state if ESP32 confirms execution.
    """
    global charging_status, relay_state, system_message, auto_cutoff_triggered, esp32_connected
    
    with state_lock:
        if battery_soc is not None and battery_soc >= CUTOFF_SOC_THRESHOLD:
            return jsonify({
                "status": "warning",
                "message": "Cannot start charging: Battery is already at full charge (100% Estimated SOC).",
                "charging_status": False,
                "relay_state": relay_state,
                "esp32_connected": esp32_connected
            }), 400
            
    # Send real command to physical ESP32
    success, resp = send_esp32_command_sync('on')
    
    with state_lock:
        if success:
            charging_status = True
            relay_state = "ON"
            esp32_connected = True
            auto_cutoff_triggered = False
            system_message = "Charging command accepted. ESP32 Relay turned ON."
            log_event("Charging started: ESP32 Relay confirmed ON.", "success")
            
            return jsonify({
                "status": "success",
                "message": "Charging STARTED successfully. Relay is ON.",
                "charging_status": True,
                "battery_voltage": battery_voltage,
                "battery_soc": battery_soc,
                "relay_state": "ON",
                "esp32_connected": True
            })
        else:
            charging_status = False
            relay_state = "OFF"
            esp32_connected = False
            system_message = f"Cannot start charging: ESP32 is OFFLINE ({resp})."
            log_event(f"Start command failed: ESP32 unreachable at {ESP32_IP}", "warning")
            
            return jsonify({
                "status": "error",
                "message": f"Hardware Offline: Could not reach ESP32 at {ESP32_IP}.",
                "charging_status": False,
                "relay_state": "OFF",
                "esp32_connected": False
            }), 503


@app.route('/stop', methods=['GET', 'POST'])
def stop_charging():
    """
    Endpoint: /stop
    Action: Requests ESP32 to turn Relay OFF.
    """
    global charging_status, relay_state, system_message, esp32_connected
    
    # Send real command to physical ESP32
    success, resp = send_esp32_command_sync('off')
    
    with state_lock:
        charging_status = False
        relay_state = "OFF"
        
        if success:
            esp32_connected = True
            system_message = "Charging stopped. ESP32 Relay confirmed OFF."
            log_event("Charging stopped: ESP32 Relay confirmed OFF.", "warning")
            return jsonify({
                "status": "success",
                "message": "Charging STOPPED. Relay is OFF.",
                "charging_status": False,
                "relay_state": "OFF",
                "esp32_connected": True
            })
        else:
            esp32_connected = False
            system_message = f"Charging stopped locally. ESP32 link offline ({resp})."
            log_event("Charging stopped locally. (ESP32 was unreachable)", "warning")
            return jsonify({
                "status": "warning",
                "message": "Charging stopped locally. ESP32 was offline.",
                "charging_status": False,
                "relay_state": "OFF",
                "esp32_connected": False
            })


@app.route('/update_battery', methods=['POST', 'GET'])
def update_battery():
    """
    Endpoint: /update_battery
    Receives real telemetry pushed by ESP32 ADC on GPIO 34.
    Accepts JSON body: {"voltage": 3.92} or GET query ?voltage=3.92
    Enforces real hardware auto cut-off if terminal voltage reaches >= 4.20V.
    """
    global charging_status, battery_voltage, battery_soc, relay_state, system_message, auto_cutoff_triggered, last_telemetry_time, esp32_connected
    
    req_voltage = None
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        req_voltage = data.get('voltage')
    else:
        req_voltage = request.args.get('voltage', type=float)
        
    if req_voltage is None:
        return jsonify({"status": "error", "message": "Missing 'voltage' telemetry parameter"}), 400
        
    try:
        req_voltage = round(float(req_voltage), 2)
    except ValueError:
        return jsonify({"status": "error", "message": "Invalid voltage value"}), 400

    with state_lock:
        esp32_connected = True
        last_telemetry_time = time.time()
        battery_voltage = req_voltage
        battery_soc = calculate_soc_from_voltage(battery_voltage)
        
        # Check automatic cut-off condition
        is_full_charge = (battery_voltage >= CUTOFF_VOLTAGE_THRESHOLD) or (battery_soc >= CUTOFF_SOC_THRESHOLD)
        
        if is_full_charge and charging_status:
            # Cut off relay immediately
            charging_status = False
            relay_state = "OFF"
            auto_cutoff_triggered = True
            system_message = f"AUTO CUT-OFF ACTIVATED: Full charge reached ({battery_voltage}V / {battery_soc}% SOC). Relay turned OFF."
            log_event(f"AUTO CUT-OFF ACTIVATED: Battery reached {battery_voltage}V ({battery_soc}% SOC). Relay turned OFF.", "danger")
            threading.Thread(target=send_esp32_command_sync, args=('off',), daemon=True).start()
        else:
            system_message = f"Telemetry received: {battery_voltage}V ({battery_soc}% Estimated SOC)"
            log_event(f"Telemetry received: {battery_voltage}V | Estimated SOC: {battery_soc}%", "info")

    return jsonify({
        "status": "success",
        "battery_voltage": battery_voltage,
        "battery_soc": battery_soc,
        "charging_status": charging_status,
        "relay_state": relay_state,
        "auto_cutoff_triggered": auto_cutoff_triggered,
        "message": system_message
    })


@app.route('/reset_cutoff', methods=['POST'])
def reset_cutoff():
    """Resets the auto cut-off alert banner once acknowledged."""
    global auto_cutoff_triggered
    with state_lock:
        auto_cutoff_triggered = False
    return jsonify({"status": "success", "message": "Cut-off alert acknowledged."})


@app.route('/events', methods=['GET'])
def get_events():
    """Returns real chronological system events."""
    with state_lock:
        return jsonify({
            "status": "success",
            "events": event_log
        })


@app.route('/status', methods=['GET'])
def get_status():
    """
    Endpoint: /status
    Action: Returns real-time metrics strictly from real hardware telemetry and state.
    """
    with state_lock:
        sensor_active = False
        if last_telemetry_time is not None:
            # Active if real telemetry received within last 30 seconds
            sensor_active = (time.time() - last_telemetry_time) < 30.0

        return jsonify({
            "charging_status": charging_status,
            "battery_voltage": battery_voltage,
            "battery_soc": battery_soc,
            "battery_level": battery_soc,
            "relay_state": relay_state,
            "esp32_connected": esp32_connected,
            "esp32_ip": ESP32_IP,
            "auto_cutoff_triggered": auto_cutoff_triggered,
            "sensor_active": sensor_active,
            "last_telemetry_time": last_telemetry_time,
            "message": system_message,
            "events": event_log[:10]
        })


# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================
if __name__ == '__main__':
    print("=" * 70)
    print(" SMART EV REMOTE CHARGING & AUTO CUT-OFF SYSTEM (REAL HARDWARE MODE)")
    print(f" Target ESP32 REST API: http://{ESP32_IP}:{ESP32_PORT}")
    print(" Serving Web Interface & API on: http://127.0.0.1:5000")
    print("=" * 70)
    app.run(host='0.0.0.0', port=5000, debug=True)
