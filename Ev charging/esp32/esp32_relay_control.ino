/*
  Smart EV Remote Charging & Auto Cut-Off System
  ESP32 Firmware Code (Arduino IDE)
  
  Description:
  - Connects to 2.4GHz Wi-Fi network.
  - Starts an HTTP REST API server on Port 80.
  - Handles /on and /off commands from Flask backend to drive Relay GPIO pin (GPIO 26).
  - Samples Li-ion battery terminal voltage via Voltage Divider on Analog Pin (GPIO 34 ADC).
  - Periodically transmits live battery voltage telemetry to Flask backend (/update_battery).
  - Returns current relay & hardware state via /status endpoint.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>

// ==============================================================================
// CONFIGURATION - WI-FI NETWORK CREDENTIALS & BACKEND TELEMETRY
// ==============================================================================
const char* ssid     = "YOUR_WIFI_NAME";     // Change to your Wi-Fi SSID
const char* password = "YOUR_WIFI_PASSWORD"; // Change to your Wi-Fi Password

// Flask backend server telemetry endpoint (Replace with your laptop/server IP)
const char* backend_server = "http://192.168.1.50:5000/update_battery";

// ==============================================================================
// HARDWARE PIN DEFINITIONS
// ==============================================================================
#define RELAY_PIN 26        // GPIO 26: Connected to 5V Relay IN pin (Active HIGH)
#define BATTERY_ADC_PIN 34  // GPIO 34: Analog input connected to Voltage Sensor / Divider

// ADC Voltage Divider Calibration constants
// For standard 5:1 voltage sensor module: V_in = V_adc * ((R1 + R2) / R2)
const float ADC_REF_VOLTAGE = 3.30;   // ESP32 ADC Reference Voltage (V)
const float ADC_RESOLUTION = 4095.0;  // 12-bit ADC Resolution
const float VOLTAGE_DIVIDER_RATIO = 5.0; // Divider ratio (5:1 sensor)

// Initialize WebServer on default HTTP Port 80
WebServer server(80);

// Variable to track physical relay status
bool isRelayON = false;

// Telemetry interval timer (send voltage every 3 seconds)
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 3000;

// ==============================================================================
// VOLTAGE MEASUREMENT HELPER FUNCTION
// ==============================================================================
float readBatteryVoltage() {
  // Read multi-sample average to filter ADC noise
  long rawSum = 0;
  const int samples = 16;
  for (int i = 0; i < samples; i++) {
    rawSum += analogRead(BATTERY_ADC_PIN);
    delay(2);
  }
  float avgRaw = (float)rawSum / samples;
  
  // Calculate voltage at ADC pin
  float vAdc = (avgRaw / ADC_RESOLUTION) * ADC_REF_VOLTAGE;
  
  // Scale by voltage divider factor to get battery terminal voltage
  float vBattery = vAdc * VOLTAGE_DIVIDER_RATIO;
  
  // Constrain to realistic 18650 range (0.0V - 5.0V)
  if (vBattery < 0.05) vBattery = 0.0;
  return vBattery;
}

// ==============================================================================
// HTTP HANDLER FUNCTIONS
// ==============================================================================

// Handle /on endpoint - Turn Relay ON (Active HIGH)
void handleOn() {
  digitalWrite(RELAY_PIN, HIGH);
  isRelayON = true;
  Serial.println("[ESP32] Received Command: TURN RELAY ON (HIGH)");
  
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "RELAY_ON_OK");
}

// Handle /off endpoint - Turn Relay OFF (LOW)
void handleOff() {
  digitalWrite(RELAY_PIN, LOW);
  isRelayON = false;
  Serial.println("[ESP32] Received Command: TURN RELAY OFF (LOW)");
  
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "RELAY_OFF_OK");
}

// Handle /status endpoint - Query relay and voltage state
void handleStatus() {
  float currentVoltage = readBatteryVoltage();
  String jsonResponse = "{\"relay_pin\":" + String(RELAY_PIN) + 
                        ",\"state\":\"" + (isRelayON ? "ON" : "OFF") + "\"" +
                        ",\"voltage\":" + String(currentVoltage, 2) + "}";
  
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", jsonResponse);
}

// Handle Root / endpoint
void handleRoot() {
  float v = readBatteryVoltage();
  String html = "<h1>Smart EV Remote Charging & Auto Cut-Off Controller</h1>";
  html += "<p>Relay Status: <b>" + String(isRelayON ? "ON" : "OFF") + "</b></p>";
  html += "<p>Battery Voltage: <b>" + String(v, 2) + " V</b></p>";
  html += "<p><a href='/on'><button>Turn ON</button></a> ";
  html += "<a href='/off'><button>Turn OFF</button></a></p>";
  
  server.send(200, "text/html", html);
}

// Handle 404 Not Found
void handleNotFound() {
  server.send(404, "text/plain", "404: Endpoint Not Found");
}

// ==============================================================================
// SEND TELEMETRY TO FLASK BACKEND
// ==============================================================================
void sendTelemetryToBackend() {
  if (WiFi.status() == WL_CONNECTED) {
    float voltage = readBatteryVoltage();
    HTTPClient http;
    http.begin(backend_server);
    http.addHeader("Content-Type", "application/json");
    
    String payload = "{\"voltage\":" + String(voltage, 2) + "}";
    int httpResponseCode = http.POST(payload);
    
    if (httpResponseCode > 0) {
      Serial.printf("[TELEMETRY] Sent voltage: %.2fV | HTTP Response: %d\n", voltage, httpResponseCode);
    } else {
      Serial.printf("[TELEMETRY ERROR] POST failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  }
}

// ==============================================================================
// INITIAL SETUP FUNCTION
// ==============================================================================
void setup() {
  // Initialize Serial Communication for debugging
  Serial.begin(115200);
  delay(500);
  
  Serial.println("\n--------------------------------------------------");
  Serial.println("⚡ SMART EV REMOTE CHARGING & AUTO CUT-OFF SYSTEM ⚡");
  Serial.println("--------------------------------------------------");

  // Configure Relay Pin as Output
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with Relay OFF for safety

  // Configure ADC pin
  pinMode(BATTERY_ADC_PIN, INPUT);

  // Connect to Wi-Fi
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  // Wait until connected to Wi-Fi
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  // Connection successful! Print assigned IP address
  Serial.println("\n[Wi-Fi Connected!]");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.println("➜ Copy this IP address and paste it into backend/app.py -> ESP32_IP");

  // Define HTTP Server Routing
  server.on("/", handleRoot);
  server.on("/on", handleOn);
  server.on("/off", handleOff);
  server.on("/status", handleStatus);
  server.onNotFound(handleNotFound);

  // Start Server
  server.begin();
  Serial.println("HTTP REST Web Server Started. Waiting for commands...\n");
}

// ==============================================================================
// MAIN LOOP FUNCTION
// ==============================================================================
void loop() {
  // Handle incoming HTTP client commands (/on, /off, /status)
  server.handleClient();

  // Periodically send battery voltage telemetry to Flask backend
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = millis();
    sendTelemetryToBackend();
  }
}
