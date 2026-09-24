int segA = 2;
int segB = 3;
int segC = 4;
int segD = 5;
int segE = 6;
int segF = 7;
int segG = 8;
int segDP = 9;

int digit1 = 10;
int digit2 = 11;
int digit3 = 12;
int digit4 = 13;

int setBtn   = A0;
int startBtn = A1;
int pauseBtn = A2;
int resetBtn = A3;
int buzzer   = A4;

int minutes = 0;
int seconds = 0;
bool running = false;
bool paused  = false;

unsigned long previousMillis = 0;
unsigned long lastSetPress   = 0;
unsigned long lastStartPress = 0;
unsigned long lastPausePress = 0;
unsigned long lastResetPress = 0;
const unsigned long DEBOUNCE = 200;

unsigned long setHoldStart    = 0;
unsigned long lastHoldAdd     = 0;
const unsigned long HOLD_DELAY    = 500;
const unsigned long HOLD_INTERVAL = 400;

byte numbers[10][7] = {
  {1,1,1,1,1,1,0}, // 0
  {0,1,1,0,0,0,0}, // 1
  {1,1,0,1,1,0,1}, // 2
  {1,1,1,1,0,0,1}, // 3
  {0,1,1,0,0,1,1}, // 4
  {1,0,1,1,0,1,1}, // 5
  {1,0,1,1,1,1,1}, // 6
  {1,1,1,0,0,0,0}, // 7
  {1,1,1,1,1,1,1}, // 8
  {1,1,1,1,0,1,1}  // 9
};

void setup() {
  pinMode(segA, OUTPUT);
  pinMode(segB, OUTPUT);
  pinMode(segC, OUTPUT);
  pinMode(segD, OUTPUT);
  pinMode(segE, OUTPUT);
  pinMode(segF, OUTPUT);
  pinMode(segG, OUTPUT);
  pinMode(segDP, OUTPUT);

  pinMode(digit1, OUTPUT);
  pinMode(digit2, OUTPUT);
  pinMode(digit3, OUTPUT);
  pinMode(digit4, OUTPUT);

  pinMode(setBtn,   INPUT_PULLUP);
  pinMode(startBtn, INPUT_PULLUP);
  pinMode(pauseBtn, INPUT_PULLUP);
  pinMode(resetBtn, INPUT_PULLUP);

  pinMode(buzzer, OUTPUT);
}

void loop() {

  displayTime();

  unsigned long now = millis();

  // ---- SET button — +15 seconds, may hold ----
  if (digitalRead(setBtn) == LOW && !running) {

    if (setHoldStart == 0) {
      setHoldStart = now;
    }

    // Short press — isang beses na +15sec
    if (now - lastSetPress > DEBOUNCE && now - setHoldStart < HOLD_DELAY) {
      lastSetPress = now;
      seconds += 15;
      if (seconds >= 60) {
        seconds -= 60;
        minutes++;
        if (minutes > 59) minutes = 0;
      }
    }

    // Hold — +15sec bawat 400ms
    if (now - setHoldStart >= HOLD_DELAY && now - lastHoldAdd >= HOLD_INTERVAL) {
      lastHoldAdd = now;
      seconds += 15;
      if (seconds >= 60) {
        seconds -= 60;
        minutes++;
        if (minutes > 59) minutes = 0;
      }
    }

  } else {
    setHoldStart = 0;
    lastHoldAdd  = 0;
  }

  // ---- START ----
  if (digitalRead(startBtn) == LOW && now - lastStartPress > DEBOUNCE) {
    lastStartPress = now;
    running = true;
    paused  = false;
  }

  // ---- PAUSE ----
  if (digitalRead(pauseBtn) == LOW && now - lastPausePress > DEBOUNCE) {
    lastPausePress = now;
    paused = !paused;
  }

  // ---- RESET ----
  if (digitalRead(resetBtn) == LOW && now - lastResetPress > DEBOUNCE) {
    lastResetPress = now;
    running = false;
    minutes = 0;
    seconds = 0;
  }

  // ---- Countdown ----
  if (running && !paused) {
    if (now - previousMillis >= 1000) {
      previousMillis = now;
      if (seconds == 0) {
        if (minutes > 0) {
          minutes--;
          seconds = 59;
        } else {
          running = false;
          tone(buzzer, 1000);
          delay(3000);
          noTone(buzzer);
        }
      } else {
        seconds--;
      }
    }
  }
}

void displayDigit(int num) {
  digitalWrite(segA, numbers[num][0]);
  digitalWrite(segB, numbers[num][1]);
  digitalWrite(segC, numbers[num][2]);
  digitalWrite(segD, numbers[num][3]);
  digitalWrite(segE, numbers[num][4]);
  digitalWrite(segF, numbers[num][5]);
  digitalWrite(segG, numbers[num][6]);
}

void displayTime() {
  int m1 = minutes / 10;
  int m2 = minutes % 10;
  int s1 = seconds / 10;
  int s2 = seconds % 10;

  digitalWrite(digit1, LOW);
  displayDigit(m1);
  delay(5);
  digitalWrite(digit1, HIGH);

  digitalWrite(digit2, LOW);
  displayDigit(m2);
  delay(5);
  digitalWrite(digit2, HIGH);

  digitalWrite(digit3, LOW);
  displayDigit(s1);
  delay(5);
  digitalWrite(digit3, HIGH);

  digitalWrite(digit4, LOW);
  displayDigit(s2);
  delay(5);
  digitalWrite(digit4, HIGH);
}