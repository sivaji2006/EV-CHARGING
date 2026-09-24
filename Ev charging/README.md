# ⚡ Smart EV Remote Charging & Auto Cut-Off System

A modern IoT engineering project designed for remote EV battery charging management and autonomous full-charge protection. The system pairs an ESP32 microcontroller with a 5V DC relay, an analog voltage sensor, and a TP4056 lithium-ion charging circuit, connected to a Python Flask REST backend and a dark-mode web monitoring dashboard.

---

## 🏗️ System Architecture & Working Principle

```text
┌─────────────────────────────────────────────────────────────┐
│                      WEB APPLICATION                        │
│         (HTML5 / Modern Dark CSS / Telemetry Dashboard)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP REST (/start, /stop, /status)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       FLASK BACKEND                         │
│         (State Manager • Telemetry Ingestion • Cut-Off)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Wi-Fi HTTP Protocol (Port 80)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     ESP32 CONTROLLER                        │
│          (Dual-Core 240MHz • Web Server & ADC Hook)         │
└──────────────────┬────────────────────────────┬─────────────┘
                   │                            │
          GPIO 34 ADC Read              GPIO 26 Digital Out
                   │                            │
                   ▼                            ▼
       ┌──────────────────────┐     ┌───────────────────────┐
       │VOLTAGE SENSOR MODULE │     │  5V DC RELAY SWITCH   │
       │  (Resistor Divider)  │     │   (Isolated Control)  │
       └───────────┬──────────┘     └───────────┬───────────┘
                   │                            │ 5V DC Power Line
                   │ Terminal Sense             ▼
                   │                ┌───────────────────────┐
                   │                │  TP4056 CHARGER BOARD │
                   │                │   (CC / CV Regulator) │
                   │                └───────────┬───────────┘
                   │                            │ Regulated Charge
                   ▼                            ▼
       ┌────────────────────────────────────────────────────┐
       │           3.7V 18650 LI-ION BATTERY CELL           │
       └────────────────────────────────────────────────────┘
```

---

## 🔌 Hardware Wiring Specification

| Component | Pin / Terminal | Connects To | Function |
|---|---|---|---|
| **ESP32 DevKit** | **GPIO 26** | Relay Module **IN** | Relay switching signal (Active HIGH) |
| **ESP32 DevKit** | **GPIO 34** | Voltage Sensor **S (Signal)** | 12-bit ADC battery voltage telemetry |
| **ESP32 DevKit** | **5V / VIN** | Relay **VCC** & Sensor **VCC** | 5V DC Operating Power |
| **ESP32 DevKit** | **GND** | Relay **GND**, Sensor **GND**, Battery **(-)** | Common Reference Ground |
| **Relay Module** | **COM / NO** | In series with **5V DC Input** to TP4056 | Power isolation gate |
| **TP4056 Module** | **OUT+ / OUT-** | 18650 Battery **(+) / (-)** | Regulated CC/CV battery charging |
| **Voltage Sensor** | **VCC / GND Sense** | 18650 Battery **(+) / (-)** | Senses 3.0V - 4.2V terminal voltage |

> [!NOTE]
> **Prototype Electrical Safety**: This prototype operates exclusively on **low-voltage 5V DC** power (USB adapter to TP4056 charger). It does not switch 230V AC mains.

---

## 📁 Repository Structure

```text
Ev charging/
├── backend/
│   ├── app.py              # Flask REST API + Telemetry Manager + Auto Cut-Off Logic
│   └── requirements.txt    # Python dependencies (Flask, Flask-CORS, requests)
├── frontend/
│   ├── index.html          # Modern Dark IoT Telemetry Dashboard
│   ├── style.css           # Automotive Dark Theme Stylesheet
│   └── script.js           # Real-Time Polling, SVG Gauge, & Chart.js Integration
├── esp32/
│   └── esp32_relay_control.ino # ESP32 Arduino C++ Firmware (Web Server + ADC Sensing)
└── README.md
```

---

## ⚙️ Setup & Execution Guide

### 1. Upload ESP32 Firmware
1. Open `esp32/esp32_relay_control.ino` in Arduino IDE.
2. Enter your 2.4GHz Wi-Fi SSID and password:
   ```cpp
   const char* ssid     = "YOUR_WIFI_NAME";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```
3. Set board to `DOIT ESP32 DEVKIT V1` and upload.
4. Open the Serial Monitor (**115200 baud**) and copy the assigned IP address (e.g. `192.168.1.100`).

### 2. Configure Flask Backend
1. Open `backend/app.py` and set the ESP32 IP:
   ```python
   ESP32_IP = "192.168.1.100"  # Set to your ESP32's IP
   ```
2. In your terminal, run:
   ```bash
   cd backend
   pip install -r requirements.txt
   python app.py
   ```

### 3. Open the Dashboard
Open your web browser and navigate to:
```text
http://127.0.0.1:5000
```

---

## 🧪 Project Viva & Demonstration Features

1. **Live Dashboard & SOC Gauge**: Visualizes real-time terminal voltage and estimated State of Charge (SOC) with SVG arc animation.
2. **Remote Start / Stop Control**: User clicks START $\rightarrow$ Flask sends `/on` to ESP32 $\rightarrow$ Relay clicks ON. User clicks STOP $\rightarrow$ Relay clicks OFF.
3. **Autonomous Auto Cut-Off**:
   - The ESP32 / sensor measures the 18650 terminal voltage.
   - When terminal voltage reaches **$\ge 4.20\text{V}$ (100% SOC)**, the system immediately cuts off the relay and triggers a prominent warning banner: `⚡ AUTO CUT-OFF ACTIVATED`.
4. **Real-Time Chart**: Plots live incoming voltage and SOC over time.
5. **System Architecture Overview Tab**: Comprehensive technical breakdown, block diagrams, and hardware specifications designed for project viva presentation.
6. **Telemetry Testing Tool (Viva Drawer)**: Floating expandable panel at the bottom right allowing mentors to inject live voltage packets (3.40V, 3.70V, 3.92V, 4.20V) to demonstrate real-time SOC updates and auto cut-off triggers without waiting for a real physical cell to charge.
