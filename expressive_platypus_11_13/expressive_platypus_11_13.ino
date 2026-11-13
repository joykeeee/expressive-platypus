/* Expressive Platypus: gesture-controlled servo
   Listens on serial for one-letter commands from the p5.js + MediaPipe sketch:
     'U' = up     -> 90° clockwise from center
     'D' = down   -> 90° counter-clockwise from center
     'W' = wiggle -> quick back-and-forth around center, then rest at center
     'C' = home   -> back to center
   After reaching either end (U or D), the servo waits HOLD_MS and then returns home on its own.
   If the servo turns the wrong way, swap the CW and CCW values.
*/

#include <Servo.h>

const int servoPin = 7;
const int CENTER = 90;   // resting position (your "0")
const int CCW    = 180;  // thumbs down: 90° counter-clockwise
const int CW     = 0;    // thumbs up: 90° clockwise
int stepDelay = 4; // ms per degree; 0 = jump straight there
const unsigned long HOLD_MS = 1500; // how long to stay at an end before going home

const int WIGGLE_ANGLE  = 20; // how far each wiggle swings either side of center
const int WIGGLE_SWINGS = 6;  // number of swings (6 = three back-and-forths)

Servo myservo;
int pos = CENTER;
int target = CENTER;
unsigned long arrivedAt = 0; // when the servo reached its current target
bool waitingToGoHome = false;
int wiggleLeft = 0;          // swings still to do in the current wiggle

void setup() {
  myservo.attach(servoPin);
  myservo.write(pos);
  Serial.begin(9600);
  Serial.println("ready"); // if this keeps reappearing, the board is resetting (usually a power problem)
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'D') { target = CCW; wiggleLeft = 0; }
    else if (c == 'U') { target = CW; wiggleLeft = 0; }
    else if (c == 'C') { target = CENTER; wiggleLeft = 0; }
    else if (c == 'W') {
      wiggleLeft = WIGGLE_SWINGS;
      // swing away from wherever it is now, so the first swing always moves
      target = (pos >= CENTER) ? CENTER - WIGGLE_ANGLE : CENTER + WIGGLE_ANGLE;
    }
    else return; // ignore newlines and anything else
    waitingToGoHome = false;
    Serial.print("got ");
    Serial.println(c);
  }

  // move one degree at a time toward the target (no for-loop, so it can react mid-move)
  if (pos != target) {
    pos += (target > pos) ? 1 : -1;
    myservo.write(pos);
    delay(stepDelay);

    if (pos == target) {
      if (wiggleLeft > 0) {
        // mid-wiggle: swing to the other side, or finish at center
        wiggleLeft--;
        if (wiggleLeft > 0) target = (target > CENTER) ? CENTER - WIGGLE_ANGLE : CENTER + WIGGLE_ANGLE;
        else target = CENTER;
      } else if (target != CENTER) {
        // just arrived at an end: start the hold timer
        arrivedAt = millis();
        waitingToGoHome = true;
      }
    }
  }

  // after holding at an end, return home
  if (waitingToGoHome && millis() - arrivedAt >= HOLD_MS) {
    target = CENTER;
    waitingToGoHome = false;
    Serial.println("going home"); // shows up in the Serial Monitor when testing
  }
}
