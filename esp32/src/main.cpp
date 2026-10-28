// Tread Control: ESP32-S3 als Bluetooth-Funkmodul der Konsole.
// Das Board ist ein reiner Vermittler: Werte, Regeln und Entscheide liegen in Tread Control auf der Konsole
// (FtmsServer, Core.appCmd). Ueber den nativen USB-Anschluss kommen Zeilen von der Konsole:
//   H <name>                  Name fuer Werbung und GAP (bis 20 Zeichen), startet die Werbung
//   V <uuid16> <hex>          lesbarer Wert (Feature, Bereiche, Trainingszustand, Laufsensor-Merkmale)
//   N <uuid16> <hex>          Meldung an alle Abonnenten (Laufdaten, Laufsensor, Zustand)
//   I <hex>                   Antwort des Steuerpunkts 0x2AD9 (Anzeige an die Abonnenten)
//   P                         Lebenszeichen (mindestens alle 3 s)
// und gehen Zeilen an die Konsole:
//   R tread-control-esp32 <version>          bereit (nach Start und auf ?)
//   C <conn> <adresse>                       Gegenstelle verbunden
//   X <conn>                                 getrennt
//   S <conn> <uuid16> <0|1|2>                Abo aus/Meldung/Anzeige
//   W <conn> <hex>                           Befehl am Steuerpunkt (nur weitergeleitet, die Konsole entscheidet)
// Ohne Lebenszeichen der Konsole beantwortet das Board den Steuerpunkt selbst mit «fehlgeschlagen» und meldet
// keine Laufdaten mehr, damit eine App nie auf veraltete Werte reagiert.
#include <Arduino.h>
#include <NimBLEDevice.h>

static const char *VERSION = "1.0.0";
static const uint16_t U_FTMS = 0x1826, U_RSC = 0x1814, U_DIS = 0x180A;
static const uint16_t U_FEAT = 0x2ACC, U_TREAD = 0x2ACD, U_TRAIN = 0x2AD3, U_SPEED = 0x2AD4, U_INCL = 0x2AD5,
                      U_CTRL = 0x2AD9, U_MACH = 0x2ADA, U_RSCM = 0x2A53, U_RSCF = 0x2A54, U_RSCL = 0x2A5D;

NimBLEServer *srv;
NimBLECharacteristic *cFeat, *cTread, *cTrain, *cSpeed, *cIncl, *cCtrl, *cMach, *cRscM, *cRscF, *cRscL;
String name = "Tread Control";
uint32_t lastPing = 0;
bool started = false, online = false;
String line;

static int hexval(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
static std::string unhex(const String &h) {
  std::string out;
  for (unsigned i = 0; i + 1 < h.length(); i += 2) {
    int a = hexval(h[i]), b = hexval(h[i + 1]);
    if (a < 0 || b < 0) break;
    out.push_back((char)(a * 16 + b));
  }
  return out;
}
static String hex(const std::string &v) {
  static const char *d = "0123456789abcdef"; String s;
  for (unsigned char c : v) { s += d[c >> 4]; s += d[c & 15]; }
  return s;
}
static NimBLECharacteristic *byUuid(uint16_t u) {
  switch (u) {
    case U_FEAT: return cFeat; case U_TREAD: return cTread; case U_TRAIN: return cTrain; case U_SPEED: return cSpeed;
    case U_INCL: return cIncl; case U_CTRL: return cCtrl; case U_MACH: return cMach; case U_RSCM: return cRscM;
    case U_RSCF: return cRscF; case U_RSCL: return cRscL; default: return nullptr;
  }
}

class SrvCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s, ble_gap_conn_desc *d) override {
    Serial.printf("C %u %s\n", d->conn_handle, NimBLEAddress(d->peer_ota_addr).toString().c_str());
    if (s->getConnectedCount() < CONFIG_BT_NIMBLE_MAX_CONNECTIONS) NimBLEDevice::startAdvertising();   // Uhr und App gleichzeitig
  }
  void onDisconnect(NimBLEServer *s, ble_gap_conn_desc *d) override {
    Serial.printf("X %u\n", d->conn_handle);
    NimBLEDevice::startAdvertising();
  }
};

class ChrCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, ble_gap_conn_desc *d) override {
    if (c != cCtrl) return;
    std::string v = c->getValue();
    if (!online) {   // Konsole stumm: nichts weiterleiten, sofort «fehlgeschlagen»
      uint8_t r[3] = {0x80, v.empty() ? (uint8_t)0 : (uint8_t)v[0], 0x04};
      cCtrl->setValue(r, 3); cCtrl->indicate();
      return;
    }
    Serial.printf("W %u %s\n", d->conn_handle, hex(v).c_str());
  }
  void onSubscribe(NimBLECharacteristic *c, ble_gap_conn_desc *d, uint16_t sub) override {
    Serial.printf("S %u %04x %u\n", d->conn_handle, c->getUUID().getNative()->u16.value, sub);
  }
};
static ChrCb chrCb;

static NimBLECharacteristic *add(NimBLEService *s, uint16_t u, uint32_t props) {
  NimBLECharacteristic *c = s->createCharacteristic(NimBLEUUID(u), props);
  c->setCallbacks(&chrCb);
  return c;
}

static void advertise() {
  NimBLEAdvertising *a = NimBLEDevice::getAdvertising();
  a->stop();
  NimBLEAdvertisementData ad, sr;
  ad.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  ad.setCompleteServices16({NimBLEUUID(U_FTMS), NimBLEUUID(U_RSC)});
  const uint8_t sd[3] = {0x01, 0x01, 0x00};   // FTMS-Servicedaten: verfuegbar, Laufband
  ad.setServiceData(NimBLEUUID(U_FTMS), std::string((const char *)sd, 3));
  sr.setName(name.c_str());
  a->setAdvertisementData(ad); a->setScanResponseData(sr);
  a->start();
  started = true;
}

static void handle(String l) {
  l.trim();
  if (l.length() == 0) return;
  char k = l[0];
  lastPing = millis();
  if (!online) { online = true; }
  if (k == 'P') return;
  if (k == '?') { Serial.printf("R tread-control-esp32 %s\n", VERSION); return; }
  if (k == 'H') {
    String n = l.substring(2); n.trim();
    if (n.length() > 0 && n.length() <= 20) name = n;
    NimBLEDevice::setDeviceName(name.c_str());
    advertise();
    Serial.printf("R tread-control-esp32 %s\n", VERSION);
    return;
  }
  if (k == 'V' || k == 'N') {
    int sp = l.indexOf(' ', 2); if (sp < 0) return;
    uint16_t u = (uint16_t)strtol(l.substring(2, sp).c_str(), nullptr, 16);
    NimBLECharacteristic *c = byUuid(u); if (!c) return;
    std::string v = unhex(l.substring(sp + 1));
    c->setValue((const uint8_t *)v.data(), v.size());
    if (k == 'N') c->notify();
    return;
  }
  if (k == 'I') {
    std::string v = unhex(l.substring(2));
    cCtrl->setValue((const uint8_t *)v.data(), v.size()); cCtrl->indicate();
    return;
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);   // ohne lesende Gegenstelle nie blockieren
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setPower(ESP_PWR_LVL_P6);
  srv = NimBLEDevice::createServer();
  srv->setCallbacks(new SrvCb());
  NimBLEService *f = srv->createService(NimBLEUUID(U_FTMS));
  cFeat = add(f, U_FEAT, NIMBLE_PROPERTY::READ);
  cTread = add(f, U_TREAD, NIMBLE_PROPERTY::NOTIFY);
  cTrain = add(f, U_TRAIN, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  cSpeed = add(f, U_SPEED, NIMBLE_PROPERTY::READ);
  cIncl = add(f, U_INCL, NIMBLE_PROPERTY::READ);
  cCtrl = add(f, U_CTRL, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::INDICATE);
  cMach = add(f, U_MACH, NIMBLE_PROPERTY::NOTIFY);
  NimBLEService *r = srv->createService(NimBLEUUID(U_RSC));
  cRscM = add(r, U_RSCM, NIMBLE_PROPERTY::NOTIFY);
  cRscF = add(r, U_RSCF, NIMBLE_PROPERTY::READ);
  cRscL = add(r, U_RSCL, NIMBLE_PROPERTY::READ);
  NimBLEService *dis = srv->createService(NimBLEUUID(U_DIS));
  dis->createCharacteristic(NimBLEUUID((uint16_t)0x2A29), NIMBLE_PROPERTY::READ)->setValue("Tread Control");
  dis->createCharacteristic(NimBLEUUID((uint16_t)0x2A24), NIMBLE_PROPERTY::READ)->setValue("ESP32-S3 Bridge");
  dis->createCharacteristic(NimBLEUUID((uint16_t)0x2A26), NIMBLE_PROPERTY::READ)->setValue(VERSION);
  // Vorgaben bis zur ersten Meldung der Konsole: Bereiche 0.8 bis 14 km/h und 0 bis 10 %, keine Steuerung, Ruhe
  const uint8_t feat[8] = {0x0C, 0x16, 0, 0, 0, 0, 0, 0}, spd[6] = {80, 0, 0x78, 0x05, 10, 0}, inc[6] = {0, 0, 100, 0, 5, 0};
  const uint8_t train[2] = {0, 1}, rscf[2] = {6, 0}, rscl[1] = {0};
  cFeat->setValue(feat, 8); cSpeed->setValue(spd, 6); cIncl->setValue(inc, 6); cTrain->setValue(train, 2);
  cRscF->setValue(rscf, 2); cRscL->setValue(rscl, 1);
  f->start(); r->start(); dis->start();
  Serial.printf("R tread-control-esp32 %s\n", VERSION);
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') { handle(line); line = ""; }
    else if (c != '\r' && line.length() < 600) line += c;
  }
  // Konsole stumm: keine Laufdaten mehr, Werbung bleibt (die Konsole kann jederzeit zurueckkommen)
  if (online && millis() - lastPing > 3000) {
    online = false;
    const uint8_t train[2] = {0, 1}; cTrain->setValue(train, 2); cTrain->notify();
    const uint8_t lost[1] = {0xFF}; cMach->setValue(lost, 1); cMach->notify();   // Steuerung verloren
  }
  if (!started && millis() > 5000) advertise();   // auch ohne Konsole sichtbar (fuer Tests am Rechner)
  delay(2);
}
